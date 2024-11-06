declare module 'elevenlabs-node' {
    // Replace 'any' with more specific types as you discover them
    interface ElevenLabsVoice {
        // Define the properties and methods you expect from the library
        textToSpeech(apiKey: string, voiceId: string, outputFile: string, text: string): Promise<void>;
        getVoices(apiKey: string): Promise<any>;
    }

    const voice: ElevenLabsVoice;
    export default voice;
}
