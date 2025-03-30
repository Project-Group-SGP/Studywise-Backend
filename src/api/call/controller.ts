import { StreamClient } from "@stream-io/node-sdk";
import { Request, Response } from "express";
import { TokenPayload } from "types";

const apiKey = process.env.GETSTREAM_API_KEY;
const apiSecret = process.env.GETSTREAM_API_SECRET;

interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export const tokenProvider = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ message: "Missing API key or secret." });
  }

  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const client = new StreamClient(apiKey, apiSecret);

    // Set token expiration to 24 hours from now
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    // Get user details from request
    const userId = req.user.id;
    const userName = req.user.name || 'Unknown User';
    
    console.log(`Generating Stream token for user: ${userId}, name: ${userName}`);

    // Create token with expiration
    const token = client.createToken(userId, expiresAt);

    // Log token for debugging (never do this in production)
    console.log(`Generated token: ${token.substring(0, 10)}...`);

    // Return token with expiration time
    res.json({ 
      token,
      expiresAt: expiresAt * 1000 // Convert to milliseconds for frontend
    });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ message: "Error generating token" });
  }
};
