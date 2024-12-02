import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import { promises as fs } from "fs";
import { exec } from "child_process";
import fetch from "node-fetch";

dotenv.config();

// Google Gemini API key
const geminiApiKey = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY";
const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "pMsXgVXv3BLzUgSXRplE";

const app = express();

app.use(express.json());
app.use(cors({
  origin: 'https://dev-pavithan-tech-e-model-frontend.vercel.app', // Your frontend URL
  methods: ['GET', 'POST', 'OPTIONS'], // Allow necessary methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Allow custom headers
  credentials: true, // Allow cookies if needed
}));

const port = 8000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  try {
    const voices = await voice.getVoices(elevenLabsApiKey);
    res.send(voices);
    console.log(voices);
  } catch (error) {
    console.error("Error fetching voices:", error);
    res.status(500).send({ error: "Failed to fetch voices" });
  }
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  await execCommand(
    `ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);
  await execCommand(
    `./bin/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  );
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

// Function to read JSON transcript
const readJsonTranscript = async (file) => {
  try {
    const data = await fs.readFile(file, "utf8");
    const jsonData = JSON.parse(data);
    console.log("Lip Sync JSON Data:", jsonData);
    return jsonData; // Ensure this returns the correct object
  } catch (error) {
    console.error(`Error reading JSON transcript from ${file}:`, error);
    throw new Error("Failed to read JSON transcript");
  }
};

// Convert audio file to base64
const audioFileToBase64 = async (file) => {
  try {
    const data = await fs.readFile(file);
    return data.toString("base64");
  } catch (error) {
    console.error(`Error converting audio file to base64:`, error);
    throw new Error("Failed to convert audio file");
  }
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  console.log("Received message:", userMessage);

  // Initial responses if userMessage is empty
  if (!userMessage) {
    try {
      res.send({
        messages: [
          {
            text: "Hey dear... How was your day?",
            audio: await audioFileToBase64("audios/intro_0.wav"),
            lipsync: await readJsonTranscript("audios/intro_0.json"),
            facialExpression: "smile",
            animation: "Talking_1",
          },
          {
            text: "I missed you so much... Please don't go for so long!",
            audio: await audioFileToBase64("audios/intro_1.wav"),
            lipsync: await readJsonTranscript("audios/intro_1.json"),
            facialExpression: "sad",
            animation: "Crying",
          },
        ],
      });
    } catch (error) {
      console.error("Error handling initial response:", error);
      return res.status(500).send({ error: "Failed to prepare initial response." });
    }
    return;
  }

  if (!elevenLabsApiKey || !geminiApiKey) {
    try {
      res.send({
        messages: [
          {
            text: "Please my dear, don't forget to add your API keys!",
            audio: await audioFileToBase64("audios/api_0.wav"),
            lipsync: await readJsonTranscript("audios/api_0.json"),
            facialExpression: "angry",
            animation: "Angry",
          },
          {
            text: "You don't want to ruin Wawa Sensei with a crazy ChatGPT and ElevenLabs bill, right?",
            audio: await audioFileToBase64("audios/api_1.wav"),
            lipsync: await readJsonTranscript("audios/api_1.json"),
            facialExpression: "smile",
            animation: "Laughing",
          },
        ],
      });
    } catch (error) {
      console.error("Error handling API keys response:", error);
      return res.status(500).send({ error: "Failed to prepare API keys response." });
    }
    return;
  }

  console.log("API keys are set.");

  try {
    // Making the request to the Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: userMessage || "Hello" }],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text(); // Get error body for better debugging
      throw new Error(`Gemini API request failed: ${response.statusText}. Response: ${errorBody}`);
    }

    const completion = await response.json();
    console.log("Gemini API response:", JSON.stringify(completion, null, 2));

    let messages = [];
    if (completion.candidates && completion.candidates.length > 0) {
      const candidate = completion.candidates[0];

      if (candidate.content && candidate.content.parts) {
        messages = candidate.content.parts.map((part, i) => ({
          text: part.text,
          facialExpression: "smile", // default for now
          animation: "Talking_1", // default animation
        }));
      } else {
        throw new Error("Unexpected response structure: 'parts' missing.");
      }
    } else {
      throw new Error("No candidates found in response.");
    }

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const fileName = `audios/message_${i}.mp3`;
      try {
        const messageText = message.text.includes("😊") ? message.text.replace("😊", "") : message.text;
        await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, messageText);
        await lipSyncMessage(i);
        message.audio = await audioFileToBase64(fileName);
        message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
      } catch (processingError) {
        console.error(`Error processing message ${i}:`, processingError);
        return res.status(500).send({ error: "Failed to process audio or lipsync." });
      }
    }

    res.send({ messages });
  } catch (error) {
    console.error("Error fetching completion:", error);
    res.status(500).send({ error: "Internal Server Error", details: error.message });
  }
});

app.listen(port, () => {
  console.log(`listening on port ${port}`);
});
