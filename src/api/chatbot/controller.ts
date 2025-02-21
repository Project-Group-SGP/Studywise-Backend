import { Request, Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { TokenPayload } from "types";

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

// Validation schema for chat request
const chatRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
});

// Study-related context
const STUDY_CONTEXT = `You are an educational AI assistant. Only provide help with academic topics like:
- Academic subjects and coursework
- Study techniques and learning methods
- Homework help and explanations
- Test preparation strategies
Avoid any non-academic or inappropriate content.`;

const isStudyRelated = (prompt: string): boolean => {
  const nonAcademicKeywords = [
    'gambling', 'betting', 'adult', 'nsfw', 'hack', 'crack',
    'cheat', 'steal', 'illegal', 'drug', 'weapon', 'violence'
  ];

  return !nonAcademicKeywords.some(keyword => 
    prompt.toLowerCase().includes(keyword)
  );
};

export const generateResponse = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const validationResult = chatRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: validationResult.error.errors,
      });
    }

    const { prompt } = validationResult.data;

    if (!isStudyRelated(prompt)) {
      return res.status(400).json({
        message: "Only academic and study-related questions are allowed"
      });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent([
      STUDY_CONTEXT,
      `Question: ${prompt}\nProvide a clear and educational response.`
    ]);
    const response = await result.response;
    const text = response.text();

    console.log(`[Chatbot] User ${user.name}: ${prompt}`);
    console.log(`[Chatbot] AI Response: ${text.substring(0, 100)}...`);

    return res.status(200).json({
      message: text,
      timestamp: new Date()
    });

  } catch (error) {
    console.error("[Chatbot] Error:", error);
    return res.status(500).json({
      message: "Failed to generate response",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
