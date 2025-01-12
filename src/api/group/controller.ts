import { Request, Response } from "express";
import { db } from "../../prismaClient";
import { TokenPayload } from "types";

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

// Helper function to generate unique code
async function generateUniqueCode(length: number = 6): Promise<string> {
    const characters: string = 
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let code: string;

    while (true) {
        code = Array.from(
            { length },
            () => characters[Math.floor(Math.random() * characters.length)]
        ).join("");

        // Check if the code already exists in the database
        const existingGroup = await db.group.findUnique({
            where: { code },
        });

        if (!existingGroup) {
            return code;
        }
    }
}

export const createGroup = async (
    req: AuthenticatedRequest,
    res: Response
): Promise<Response> => {
    try {
        const user = req.user;
        console.log("Inside createGroup");

        if (!user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Type assertion for id
        const { id } = user as TokenPayload;

        // Destructure and validate request body
        const { name, description, subject } = req.body as CreateGroupPayload;

        if (!name || !subject) {
            return res.status(400).json({ 
                message: "Name and subject are required" 
            });
        }

        const code = await generateUniqueCode();
        console.log(code);

        // Create the group in database
        const newGroup = await db.group.create({
            data: {
                name,
                description: description || "", // Provide default value if description is undefined
                code,
                creatorId: id,
            }
        });


        console.log("Group created successfully");
        console.log(newGroup);
        

        return res.status(201).json({
            message: "Group created successfully",
            group: newGroup
        });

    } catch (error) {
        console.error("Error creating group:", error);
        return res.status(500).json({ 
            message: "Failed to create group" 
        });
    }
};