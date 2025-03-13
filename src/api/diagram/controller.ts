import { GoogleGenerativeAI } from "@google/generative-ai";
import { Request, Response } from "express";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export const generateDiagram = async (req: Request, res: Response) => {
  try {
    // Get prompt from request body
    console.log(req.body);
    const { prompt } = req.body;

    // Validate the prompt
    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Please provide a valid prompt in the request body",
      });
    }

    // Create a model instance
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    // Generate content with specific instructions to create mermaid code
    const result = await model.generateContent(`
      Generate a mermaid diagram based on the following description. 
      Respond ONLY with valid mermaid code without any explanations, markdown formatting, or backticks.
      
      Description: ${prompt}
    `);

    // Extract the response text
    const response = result.response;
    let mermaidCode = response.text().trim();

    // Remove any "```mermaid" and "```" that might be in the response
    mermaidCode = mermaidCode
      .replace(/```mermaid/g, "")
      .replace(/```/g, "")
      .trim();

    // Validate the mermaid code
    if (!mermaidCode || mermaidCode.length < 5) {
      return res.status(400).json({
        success: false,
        error: "Failed to generate valid mermaid code",
      });
    }

    // Return the mermaid code
    return res.status(200).json({
      success: true,
      mermaidCode,
    });
  } catch (error) {
    console.error("Error generating diagram:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to generate diagram",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
