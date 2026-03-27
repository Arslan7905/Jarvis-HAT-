Codex Next Instructions – Secure AI Backend Using Your Key

Objective:
Generate a Node.js + Express backend for JarvisAI that calls OpenAI GPT-4 securely, using your API key in an environment variable, and serves AI responses to the TV UI.

Requirements for Codex
Server Setup
Use Express.js to create the backend.
Listen on port 3001.
Print "AI backend running on port 3001" when server starts.
Include CORS to allow TV UI requests.
Environment Variable for API Key
Use your existing API key via process.env.OPENAI_API_KEY.
Do NOT hardcode the key in frontend code.
Codex should generate code that reads it securely.
Example in backend:
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
POST Endpoint
Endpoint: /api/ai/chat
Accepts JSON:
{ "prompt": "user question" }
Returns JSON:
{ "text": "AI response from ChatGPT" }
OpenAI API Call
Use model GPT-4 (chat completions).
Forward prompt from TV UI.
Return only the AI-generated text to the frontend.
Error Handling
Catch network or API errors.
Return JSON error:
{ "error": "AI request failed" }
JSON Parsing
Use Express middleware to parse request bodies (express.json()).
Async/Await
Use async/await for OpenAI API requests.
Ensure the response is sent after awaiting completion.
Code Clarity
Include comments explaining:
Express server setup
Endpoint creation
OpenAI request logic
Error handling
Optional Enhancements for Codex
Use modern ES module imports: import express from "express".
Validate input to handle empty or invalid prompts gracefully.
Ready to run with node server.js or nodemon.
Keep code clean, modular, and production-ready.