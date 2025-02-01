import { db } from "../../prismaClient";
import { TokenPayload } from "types";
import { Response } from "express";
// Define interface for authenticated request
interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
  }
  
  // Define interface for group creation payload
  interface CreateGroupPayload {
    name: string;
    description?: string;
    subject: string;
  }

// get all sessions
export const getAllSessions = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user;
        console.log("Inside getAllSessions");

        if (!user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { id } = user as TokenPayload;

        // get all sessions of that group

        const { groupId } = req.body as unknown as { groupId: string };
        
        const sessions = await db.session.findMany({
            where: {
                groupId: groupId,
            },
        });

        res.status(200).json(sessions);
        
    } catch (error) {
        console.error("Error getting sessions:", error);
        res.status(500).json({ message: "Failed to get sessions" });
    }
}

// create new session
export const createSession = async (req: AuthenticatedRequest, res: Response) => {
    try {

        const user = req.user;
        console.log("Inside createSession");
        
        if (!user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { id } = user as TokenPayload;
        const { name, description, subject , groupId } = JSON.parse(req.body as unknown as string) as { name: string; description: string; subject: string;  groupId: string; };

        const session = await db.session.create({
            data: {
                name,
                description,
                groupId,
                creatorID: id,
            },
        });

        res.status(200).json(session);

    }catch (error) {
        console.error("Error creating session:", error);
        res.status(500).json({ message: "Failed to create session" });
    }
}

// delete session
export const deleteSession = async (req: AuthenticatedRequest, res: Response) => {
    try {

        const user = req.user;
        console.log("Inside deleteSession");
        
        if (!user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { id } = user as TokenPayload;
        const { sessionId } = req.body as unknown as { sessionId: string };

        const session = await db.session.delete({
            where: {
                id: sessionId,
            },
        });

        res.status(200).json(session);

    }catch (error) {
        console.error("Error deleting session:", error);
        res.status(500).json({ message: "Failed to delete session" });
    }
}

// update session
export const updateSession = async (req: AuthenticatedRequest, res: Response) => {
    try {

        const user = req.user;
        
        if (!user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { id } = user as TokenPayload;
        const { sessionId, name, description, subject } = JSON.parse(req.body as unknown as string) as { sessionId: string; name: string; description: string; subject: string; };

        const session = await db.session.update({
            where: {
                id: sessionId,
            },
            data: {
                name,
                description,
            },
        });

        res.status(200).json(session);

    }catch (error) {
        console.error("Error updating session:", error);
        res.status(500).json({ message: "Failed to update session" });
    }
}
        