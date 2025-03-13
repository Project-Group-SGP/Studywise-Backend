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

    // Generate content with instructions to first validate and then create mermaid code
    const result = await model.generateContent(`
      First, determine if the following request is asking for a diagram that can be created using mermaid syntax.
      
      If it IS a valid diagram request that can be represented in mermaid, respond ONLY with valid mermaid code without any explanations, markdown formatting, or backticks.
      
      If it is NOT a valid diagram request or cannot be represented in mermaid, respond with "INVALID_REQUEST:" followed by a brief explanation.
      
      Request: ${prompt}
    `);

    // Extract the response text
    const response = result.response;
    let responseText = response.text().trim();

    // Check if the response indicates an invalid request
    if (responseText.startsWith("INVALID_REQUEST:")) {
      const explanation = responseText.replace("INVALID_REQUEST:", "").trim();

      return res.status(400).json({
        success: false,
        error: "Unable to generate diagram from your request",
        details:
          explanation ||
          "Your request doesn't seem to be for a diagram or isn't compatible with mermaid syntax",
      });
    }

    // Process as mermaid code if it's valid
    let mermaidCode = responseText
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
