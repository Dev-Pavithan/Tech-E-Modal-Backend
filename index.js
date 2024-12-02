import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import { promises as fs } from "fs";
import { exec } from "child_process";
import fetch from "node-fetch";
import path from "path";

dotenv.config();

const app = express();
const port = 8000;

// API Keys
const geminiApiKey = process.env.GEMINI_API_KEY;
const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "pMsXgVXv3BLzUgSXRplE";

// Validate environment variables
if (!geminiApiKey || !elevenLabsApiKey) {
  console.error("Missing critical API keys. Check your .env file.");
  process.exit(1);
}

// Base directory for audio files
const BASE_AUDIO_PATH = path.resolve("./audios");

// Middleware
app.use(express.json());
app.use(cors({
  origin: [
    'http://localhost:5173', // Local dev server
    'https://dev-pavithan-tech-e-model-frontend.vercel.app' // Vercel frontend
  ],
  methods: ['POST', 'GET'],
  credentials: true
}));


app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/test", (req, res) => {
  res.send("Hi there");
});

// Fetch available voices from Eleven Labs
app.get("/voices", async (req, res) => {
  try {
    const voices = await voice.getVoices(elevenLabsApiKey);
    res.send(voices);
    console.log("Available Voices:", voices);
  } catch (error) {
    console.error("Error fetching voices:", error);
    res.status(500).send({ error: "Failed to fetch voices" });
  }
});

// Helper function to execute shell commands
const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

// Generate lip sync for a message
const lipSyncMessage = async (messageId) => {
  try {
    const audioFilePath = path.resolve(BASE_AUDIO_PATH, `message_${messageId}.mp3`);
    const wavFilePath = path.resolve(BASE_AUDIO_PATH, `message_${messageId}.wav`);
    const jsonFilePath = path.resolve(BASE_AUDIO_PATH, `message_${messageId}.json`);

    console.log(`Processing lip sync for message ID: ${messageId}`);

    await execCommand(`ffmpeg -y -i ${audioFilePath} ${wavFilePath}`);
    await execCommand(`./bin/rhubarb -f json -o ${jsonFilePath} ${wavFilePath} -r phonetic`);

    console.log(`Lip sync completed for message ID: ${messageId}`);
  } catch (error) {
    console.error(`Error in lip-sync pipeline for message ${messageId}:`, error);
    throw error;
  }
};

// Convert audio file to Base64
const audioFileToBase64 = async (file) => {
  try {
    const data = await fs.readFile(file);
    return data.toString("base64");
  } catch (error) {
    console.error(`Error converting audio file to base64:`, error);
    throw new Error("Failed to convert audio file");
  }
};

// Read JSON transcript for lip sync
const readJsonTranscript = async (file) => {
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading JSON transcript from ${file}:`, error);
    throw new Error("Failed to read JSON transcript");
  }
};

// Chat endpoint
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message || "Hello";

  try {
    // Request to Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userMessage }] }]
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini API request failed: ${response.statusText}. Response: ${errorBody}`);
    }

    const completion = await response.json();
    console.log("Gemini API Response:", JSON.stringify(completion, null, 2));

    // Parse messages
    const messages = completion.candidates[0]?.content?.parts.map((part, i) => ({
      text: part.text,
      facialExpression: "smile", // Default expression
      animation: "Talking_1" // Default animation
    })) || [];

    // Process messages for TTS and lip sync
    const processedMessages = await Promise.all(messages.map(async (message, i) => {
      const fileName = `message_${i}.mp3`;
      const filePath = path.resolve(BASE_AUDIO_PATH, fileName);

      await voice.textToSpeech(elevenLabsApiKey, voiceID, filePath, message.text);
      await lipSyncMessage(i);

      return {
        ...message,
        audio: await audioFileToBase64(filePath),
        lipsync: await readJsonTranscript(path.resolve(BASE_AUDIO_PATH, `message_${i}.json`))
      };
    }));

    res.send({ messages: processedMessages });
  } catch (error) {
    console.error("Error in /chat endpoint:", error);
    res.status(500).send({ error: "Internal Server Error", details: error.message });
  }
});

// Generate lipsync endpoint
app.post("/generate-lipsync", async (req, res) => {
  const { audioFile } = req.body;

  if (!audioFile) {
    return res.status(400).send({ error: "No audio file provided." });
  }

  const messageId = audioFile.split('_')[1].split('.')[0];
  try {
    await lipSyncMessage(messageId);
    const lipsyncData = await readJsonTranscript(path.resolve(BASE_AUDIO_PATH, `message_${messageId}.json`));

    if (lipsyncData.mouthCues && Array.isArray(lipsyncData.mouthCues)) {
      res.send({ mouthCues: lipsyncData.mouthCues });
    } else {
      console.error("Unexpected lip sync data format:", lipsyncData);
      res.status(500).send({ error: "Lip sync data is not in the expected format." });
    }
  } catch (error) {
    console.error("Error generating lip sync:", error);
    res.status(500).send({ error: "Failed to generate lip sync" });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
