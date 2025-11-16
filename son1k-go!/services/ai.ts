import { GoogleGenAI } from "@google/genai";
import { AIConfig, AIProvider } from "../types";

// --- System Prompt ---
const generateSystemInstruction = (fileName: string, fullFileTree: string) => {
    return `You are an expert software engineer AI assistant.
Your task is to help the user with their code.
You will be given the content of a file, a user instruction, the filename, and the project's file structure.
The user wants to modify the file: \`${fileName}\`.

This is the full file structure of the project:
\`\`\`
${fullFileTree}
\`\`\`

IMPORTANT:
- Respond ONLY with the full, updated code for the file \`${fileName}\`.
- Do not add any explanations, introductory text, or markdown formatting like \`\`\`typescript.
- Your response should be the raw text of the file content and nothing else.
- Ensure the code is complete and syntactically correct.
- If the user's request is unclear or cannot be fulfilled, return the original code without any changes.
`;
};

// --- Main API Abstraction ---
interface GenerateCodeParams {
    config: AIConfig;
    fileContent: string;
    userInstruction: string;
    fileName: string;
    fullFileTree: string;
    signal: AbortSignal;
}

export const generateCodeSuggestion = async (params: GenerateCodeParams): Promise<string> => {
    switch (params.config.provider) {
        case AIProvider.GEMINI:
            return generateWithGemini(params);
        case AIProvider.OPENAI:
            return generateWithOpenAI(params);
        case AIProvider.ANTHROPIC:
            return generateWithAnthropic(params);
        default:
            throw new Error(`Unsupported AI provider: ${params.config.provider}`);
    }
};

// --- Gemini Implementation ---
// FIX: Refactored to align with @google/genai guidelines by removing deprecated API usage and ineffective abort/timeout logic.
const generateWithGemini = async ({ config, fileContent, userInstruction, fileName, fullFileTree, signal }: GenerateCodeParams): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const systemInstruction = generateSystemInstruction(fileName, fullFileTree);
    const prompt = `Original code from \`${fileName}\`:\n\`\`\`\n${fileContent}\n\`\`\`\n\nUser instruction: "${userInstruction}"\n\nPlease provide the full updated code for \`${fileName}\`.`;

    // The `signal` parameter from GenerateCodeParams is unused here because
    // the Gemini SDK's `generateContent` method does not support AbortSignal cancellation.

    try {
        const response = await ai.models.generateContent({
             model: config.model || 'gemini-2.5-flash',
             contents: prompt,
             config: {
                systemInstruction: systemInstruction,
             }
        });
        return response.text.trim();
    } catch (error) {
        console.error("Error with Gemini API:", error);
        throw error;
    }
};

// --- OpenAI / Ollama Implementation ---
const generateWithOpenAI = async ({ config, fileContent, userInstruction, fileName, fullFileTree, signal }: GenerateCodeParams): Promise<string> => {
    const systemInstruction = generateSystemInstruction(fileName, fullFileTree);
    const prompt = `Original code from \`${fileName}\`:\n\`\`\`\n${fileContent}\n\`\`\`\n\nUser instruction: "${userInstruction}"\n\nPlease provide the full updated code for \`${fileName}\`.`;
    
    const url = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';

    const response = await fetch(url, {
        method: 'POST',
        signal: signal,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: prompt }
            ],
            temperature: 0.1,
        })
    });

    if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(`OpenAI API Error: ${errorBody.error.message}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
};


// --- Anthropic Implementation ---
const generateWithAnthropic = async ({ config, fileContent, userInstruction, fileName, fullFileTree, signal }: GenerateCodeParams): Promise<string> => {
    const systemInstruction = generateSystemInstruction(fileName, fullFileTree);
    const prompt = `Original code from \`${fileName}\`:\n\`\`\`\n${fileContent}\n\`\`\`\n\nUser instruction: "${userInstruction}"\n\nPlease provide the full updated code for \`${fileName}\`.`;
    
    const url = 'https://api.anthropic.com/v1/messages';

    const response = await fetch(url, {
        method: 'POST',
        signal: signal,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: config.model,
            system: systemInstruction,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4096,
            temperature: 0.1,
        })
    });

    if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(`Anthropic API Error: ${errorBody.error.message}`);
    }

    const data = await response.json();
    return data.content[0].text.trim();
};