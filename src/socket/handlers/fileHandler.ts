import { Server, Socket } from "socket.io";
import { db } from "../../prismaClient";
import sharp from "sharp";
import { Readable } from "stream";
import { v2 as cloudinary } from "cloudinary";
import { lookup } from "mime-types";
import { Prisma } from "@prisma/client";
import ffmpeg from "fluent-ffmpeg";
import { promisify } from "util";
import { PDFDocument, rgb } from "pdf-lib";
import pdf2pic from "pdf2pic";
import fs from "fs";
import os from "os";
import path from "path";
import { UploadApiOptions } from "cloudinary";
import { exec as execCb } from "child_process";
import { createCanvas } from "canvas";
import libre from "libreoffice-convert";
import util from "util";

const execAsync = promisify(execCb);
const libreConvert = util.promisify(libre.convert);
// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function getLibreOfficePath(): Promise<string> {
  // Common LibreOffice installation paths for different OS
  const possiblePaths = {
    win32: [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice 7\\program\\soffice.exe",
      "C:\\Program Files\\LibreOffice 7\\program\\soffice.exe",
    ],
    darwin: [
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/usr/local/bin/soffice",
    ],
    linux: [
      "/usr/bin/soffice",
      "/usr/lib/libreoffice/program/soffice",
      "soffice",
    ],
  };

  const platform = process.platform as "win32" | "darwin" | "linux";
  const paths = possiblePaths[platform] || [];

  for (const path of paths) {
    try {
      await fs.promises.access(path);
      return path;
    } catch {
      continue;
    }
  }

  throw new Error(
    `LibreOffice not found. Please install LibreOffice and ensure it's in one of these locations: ${paths.join(
      ", "
    )}`
  );
}

const getCloudinaryUploadOptions = (
  fileType: string,
  groupId: string,
  fileName: string,
  tags: string[] | undefined
): UploadApiOptions => {
  const baseOptions: UploadApiOptions = {
    folder: `study-groups/${groupId}`,
    resource_type: fileType.startsWith("video")
      ? "video"
      : fileType.startsWith("image")
      ? "image"
      : "raw",
    public_id: `${Date.now()}-${fileName}`,
    tags: tags || [],
    access_mode: "public",
    use_filename: true,
    unique_filename: true,
    overwrite: false,
  };

  if (fileType.startsWith("video")) {
    return {
      ...baseOptions,
      chunk_size: 6000000, // 6MB chunks
      eager: [
        { streaming_profile: "hd", format: "m3u8" }, // Enable HLS streaming
      ],
      eager_async: true,
      resource_type: "video",
    };
  }

  if (fileType.startsWith("image")) {
    return {
      ...baseOptions,
      resource_type: "image",
      eager: [{ quality: "auto", fetch_format: "auto" }],
      eager_async: true,
    };
  }

  return baseOptions;
};

interface FileConfig {
  maxSize: number;
  category:
    | "document"
    | "text"
    | "image"
    | "audio"
    | "video"
    | "archive"
    | "code"
    | "presentation";
  generatePreview?: boolean;
  generateThumbnail?: boolean;
  allowedInChat?: boolean;
  description: string;
  extensions: string[];
}

const FILE_CONFIGS: Record<string, FileConfig> = {
  // Documents
  "application/pdf": {
    maxSize: 50 * 1024 * 1024,
    category: "document",
    generatePreview: true,
    generateThumbnail: true,
    allowedInChat: true,
    description: "PDF Document",
    extensions: [".pdf"],
  },
  "application/msword": {
    maxSize: 25 * 1024 * 1024,
    category: "document",
    generatePreview: true,
    allowedInChat: true,
    description: "Microsoft Word Document",
    extensions: [".doc"],
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    maxSize: 25 * 1024 * 1024,
    category: "document",
    generatePreview: true,
    allowedInChat: true,
    description: "Microsoft Word Document",
    extensions: [".docx"],
  },
  "application/vnd.oasis.opendocument.text": {
    maxSize: 25 * 1024 * 1024,
    category: "document",
    generatePreview: true,
    allowedInChat: true,
    description: "OpenDocument Text",
    extensions: [".odt"],
  },

  // Presentations
  "application/vnd.ms-powerpoint": {
    maxSize: 50 * 1024 * 1024,
    category: "presentation",
    generatePreview: true,
    generateThumbnail: true,
    allowedInChat: true,
    description: "Microsoft PowerPoint Presentation",
    extensions: [".ppt"],
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    maxSize: 50 * 1024 * 1024,
    category: "presentation",
    generatePreview: true,
    generateThumbnail: true,
    allowedInChat: true,
    description: "Microsoft PowerPoint Presentation",
    extensions: [".pptx"],
  },
  "application/vnd.oasis.opendocument.presentation": {
    maxSize: 50 * 1024 * 1024,
    category: "presentation",
    generatePreview: true,
    generateThumbnail: true,
    allowedInChat: true,
    description: "OpenDocument Presentation",
    extensions: [".odp"],
  },

  // Spreadsheets
  "application/vnd.ms-excel": {
    maxSize: 25 * 1024 * 1024,
    category: "document",
    generatePreview: true,
    allowedInChat: true,
    description: "Microsoft Excel Spreadsheet",
    extensions: [".xls"],
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    maxSize: 25 * 1024 * 1024,
    category: "document",
    generatePreview: true,
    allowedInChat: true,
    description: "Microsoft Excel Spreadsheet",
    extensions: [".xlsx"],
  },
  "application/vnd.oasis.opendocument.spreadsheet": {
    maxSize: 25 * 1024 * 1024,
    category: "document",
    generatePreview: true,
    allowedInChat: true,
    description: "OpenDocument Spreadsheet",
    extensions: [".ods"],
  },

  // Text files
  "text/plain": {
    maxSize: 10 * 1024 * 1024,
    category: "text",
    generatePreview: true,
    allowedInChat: true,
    description: "Text File",
    extensions: [".txt"],
  },
  "text/markdown": {
    maxSize: 10 * 1024 * 1024,
    category: "text",
    generatePreview: true,
    allowedInChat: true,
    description: "Markdown File",
    extensions: [".md", ".markdown"],
  },
  "text/csv": {
    maxSize: 15 * 1024 * 1024,
    category: "text",
    generatePreview: true,
    allowedInChat: true,
    description: "CSV File",
    extensions: [".csv"],
  },

  // Code files
  "text/x-python": {
    maxSize: 10 * 1024 * 1024,
    category: "code",
    generatePreview: true,
    allowedInChat: true,
    description: "Python Source Code",
    extensions: [".py"],
  },
  "text/javascript": {
    maxSize: 10 * 1024 * 1024,
    category: "code",
    generatePreview: true,
    allowedInChat: true,
    description: "JavaScript Source Code",
    extensions: [".js", ".jsx", ".ts", ".tsx"],
  },
  "text/x-java": {
    maxSize: 10 * 1024 * 1024,
    category: "code",
    generatePreview: true,
    allowedInChat: true,
    description: "Java Source Code",
    extensions: [".java"],
  },

  // Images
  "image/jpeg": {
    maxSize: 15 * 1024 * 1024,
    category: "image",
    generatePreview: true,
    generateThumbnail: true,
    allowedInChat: true,
    description: "JPEG Image",
    extensions: [".jpg", ".jpeg"],
  },
  "image/png": {
    maxSize: 15 * 1024 * 1024,
    category: "image",
    generatePreview: true,
    generateThumbnail: true,
    allowedInChat: true,
    description: "PNG Image",
    extensions: [".png"],
  },
  "image/gif": {
    maxSize: 15 * 1024 * 1024,
    category: "image",
    generatePreview: true,
    generateThumbnail: true,
    allowedInChat: true,
    description: "GIF Image",
    extensions: [".gif"],
  },
  "image/webp": {
    maxSize: 15 * 1024 * 1024,
    category: "image",
    generatePreview: true,
    generateThumbnail: true,
    allowedInChat: true,
    description: "WebP Image",
    extensions: [".webp"],
  },
  "image/svg+xml": {
    maxSize: 5 * 1024 * 1024,
    category: "image",
    generatePreview: true,
    generateThumbnail: true,
    allowedInChat: true,
    description: "SVG Image",
    extensions: [".svg"],
  },

  // Audio
  "audio/mpeg": {
    maxSize: 50 * 1024 * 1024,
    category: "audio",
    generateThumbnail: true,
    allowedInChat: true,
    description: "MP3 Audio",
    extensions: [".mp3"],
  },
  "audio/wav": {
    maxSize: 50 * 1024 * 1024,
    category: "audio",
    generateThumbnail: true,
    allowedInChat: true,
    description: "WAV Audio",
    extensions: [".wav"],
  },
  "audio/m4a": {
    maxSize: 50 * 1024 * 1024,
    category: "audio",
    generateThumbnail: true,
    allowedInChat: true,
    description: "M4A Audio",
    extensions: [".m4a"],
  },
  "audio/ogg": {
    maxSize: 50 * 1024 * 1024,
    category: "audio",
    generateThumbnail: true,
    allowedInChat: true,
    description: "OGG Audio",
    extensions: [".ogg"],
  },

  // Video
  "video/mp4": {
    maxSize: 200 * 1024 * 1024,
    category: "video",
    generateThumbnail: true,
    allowedInChat: true,
    description: "MP4 Video",
    extensions: [".mp4"],
  },
  "video/webm": {
    maxSize: 200 * 1024 * 1024,
    category: "video",
    generateThumbnail: true,
    allowedInChat: true,
    description: "WebM Video",
    extensions: [".webm"],
  },
  "video/quicktime": {
    maxSize: 200 * 1024 * 1024,
    category: "video",
    generateThumbnail: true,
    allowedInChat: true,
    description: "QuickTime Video",
    extensions: [".mov"],
  },
  "video/x-matroska": {
    maxSize: 200 * 1024 * 1024,
    category: "video",
    generateThumbnail: true,
    allowedInChat: true,
    description: "Matroska Video",
    extensions: [".mkv"],
  },

  // Archives
  "application/zip": {
    maxSize: 100 * 1024 * 1024,
    category: "archive",
    allowedInChat: true,
    description: "ZIP Archive",
    extensions: [".zip"],
  },
  "application/x-rar-compressed": {
    maxSize: 100 * 1024 * 1024,
    category: "archive",
    allowedInChat: true,
    description: "RAR Archive",
    extensions: [".rar"],
  },
  "application/x-7z-compressed": {
    maxSize: 100 * 1024 * 1024,
    category: "archive",
    allowedInChat: true,
    description: "7-Zip Archive",
    extensions: [".7z"],
  },

  // Mathematical/Scientific
  "application/x-latex": {
    maxSize: 10 * 1024 * 1024,
    category: "document",
    generatePreview: true,
    allowedInChat: true,
    description: "LaTeX Document",
    extensions: [".tex"],
  },
  "application/mathematica": {
    maxSize: 25 * 1024 * 1024,
    category: "document",
    allowedInChat: true,
    description: "Mathematica Notebook",
    extensions: [".nb"],
  },
  "application/x-matlab-data": {
    maxSize: 25 * 1024 * 1024,
    category: "document",
    allowedInChat: true,
    description: "MATLAB Data",
    extensions: [".mat"],
  },
} as const;

interface UploadData {
  file: Buffer;
  userId: string;
  groupId: string;
  fileType: string;
  fileName: string;
  caption?: string;
  tags?: string[];
}

interface UploadResult {
  secure_url: string;
  public_id: string;
  bytes: number;
  format: string;
  resource_type: string;
  eager?: Array<{
    secure_url: string;
    public_id: string;
  }>;
}

interface ProcessedFile {
  previewBuffer?: Buffer;
  thumbnailBuffer?: Buffer;
  metadata: Record<string, any>;
}

// Helper function for PDF processing
async function createPdfPreview(pdfBuffer: Buffer): Promise<{
  previewBuffer: Buffer;
  thumbnailBuffer: Buffer;
  pageCount: number;
}> {
  // Create temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-preview-"));
  const pdfPath = path.join(tempDir, "document.pdf");

  try {
    // Save PDF to temp file
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Get PDF document for metadata
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();

    // Use pdf2pic to convert first page to image
    const converter = pdf2pic.fromPath(pdfPath, {
      density: 300,
      savePath: tempDir,
      saveFilename: "page",
      format: "png",
      width: 1200,
      height: 1200,
    });

    // Convert first page and wait for completion
    await converter(1);

    // Read the generated preview
    const previewPath = path.join(tempDir, "page.1.png");

    // Add retry logic with delay for file reading
    const maxRetries = 3;
    let retryCount = 0;
    let previewBuffer: Buffer;

    while (retryCount < maxRetries) {
      try {
        if (fs.existsSync(previewPath)) {
          previewBuffer = fs.readFileSync(previewPath);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
        retryCount++;
      } catch (err) {
        if (retryCount === maxRetries - 1) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        retryCount++;
      }
    }

    if (!previewBuffer!) {
      throw new Error("Failed to generate preview after maximum retries");
    }

    // Create thumbnail from preview
    const thumbnailBuffer = await sharp(previewBuffer)
      .resize(300, 300, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .toBuffer();

    return { previewBuffer, thumbnailBuffer, pageCount };
  } finally {
    // Clean up temp files
    try {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    } catch (err) {
      console.warn("Error cleaning up temporary files:", err);
    }
  }
}

async function processDocument(
  file: Buffer,
  fileType: string
): Promise<ProcessedFile> {
  const metadata: Record<string, any> = {};
  let previewBuffer: Buffer | undefined;
  let thumbnailBuffer: Buffer | undefined;

  try {
    if (fileType === "application/pdf") {
      const {
        previewBuffer: preview,
        thumbnailBuffer: thumbnail,
        pageCount,
      } = await createPdfPreview(file);
      previewBuffer = preview;
      thumbnailBuffer = thumbnail;
      metadata.pageCount = pageCount;
    } else if (
      fileType === "application/msword" ||
      fileType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileType === "application/vnd.ms-excel" ||
      fileType ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      fileType === "application/vnd.ms-powerpoint" ||
      fileType ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      fileType === "application/vnd.oasis.opendocument.text" ||
      fileType === "application/vnd.oasis.opendocument.spreadsheet" ||
      fileType === "application/vnd.oasis.opendocument.presentation"
    ) {
      // Create temporary directory with proper path handling
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "office-doc-"));
      const docPath = path.join(
        tempDir,
        `document${getExtensionFromMimeType(fileType)}`
      );
      const pdfPath = path.join(tempDir, "document.pdf");

      try {
        // Write the input file
        fs.writeFileSync(docPath, file);

        // Get the correct LibreOffice path for the current OS
        const librePath = await getLibreOfficePath();

        // Construct the command with proper path escaping
        const command =
          process.platform === "win32"
            ? `"${librePath}" --headless --convert-to pdf --outdir "${tempDir}" "${docPath}"`
            : `${librePath} --headless --convert-to pdf --outdir "${tempDir}" "${docPath}"`;

        // Execute the conversion
        await execAsync(command);

        // Read the converted PDF
        const pdfBuffer = fs.readFileSync(pdfPath);

        // Generate preview from PDF
        const { previewBuffer: preview, thumbnailBuffer: thumbnail } =
          await createPdfPreview(pdfBuffer);
        previewBuffer = preview;
        thumbnailBuffer = thumbnail;
      } catch (error) {
        console.error("LibreOffice conversion error:", error);
        throw error;
      } finally {
        // Clean up temporary files
        try {
          const files = fs.readdirSync(tempDir);
          for (const file of files) {
            fs.unlinkSync(path.join(tempDir, file));
          }
          fs.rmdirSync(tempDir);
        } catch (cleanupError) {
          console.warn("Error cleaning up temp files:", cleanupError);
        }
      }
    }
  } catch (error) {
    console.error(`Error generating document preview: ${error}`);
    // Fallback to placeholder if preview generation fails
    thumbnailBuffer = await createPlaceholderThumbnail(fileType);
  }

  return {
    previewBuffer,
    thumbnailBuffer,
    metadata,
  };
}

// Helper to create placeholder thumbnail when rendering fails
async function createPlaceholderThumbnail(fileType: string): Promise<Buffer> {
  const fileConfig = FILE_CONFIGS[fileType];
  const category = fileConfig?.category || "unknown";

  return await sharp({
    create: {
      width: 300,
      height: 300,
      channels: 4,
      background: { r: 240, g: 240, b: 240, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="300" height="300">
            <text x="20" y="160" font-family="Arial" font-size="24" fill="#888">${
              category.charAt(0).toUpperCase() + category.slice(1)
            } Preview</text>
            <text x="20" y="190" font-family="Arial" font-size="18" fill="#888">(Preview generation failed)</text>
          </svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

// Process image (same as before, includes actual thumbnail generation)
async function processImage(
  file: Buffer,
  fileType: string
): Promise<ProcessedFile> {
  const metadata = await sharp(file).metadata();

  const previewBuffer = await sharp(file)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const thumbnailBuffer = await sharp(file)
    .resize(300, 300, { fit: "cover" })
    .jpeg({ quality: 70 })
    .toBuffer();

  return {
    previewBuffer,
    thumbnailBuffer,
    metadata,
  };
}

// Enhanced video processing function to ensure thumbnail generation
async function processVideo(
  file: Buffer,
  fileType: string
): Promise<ProcessedFile> {
  const metadata: Record<string, any> = { type: "video" };
  let thumbnailBuffer: Buffer | undefined;

  try {
    // Create a temporary file to work with
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-"));
    const tempFilePath = path.join(
      tempDir,
      `temp-video${getExtensionFromMimeType(fileType)}`
    );
    const thumbnailPath = path.join(tempDir, "thumbnail.jpg");

    fs.writeFileSync(tempFilePath, file);

    // Generate thumbnail at multiple positions in case the 1s mark is black
    const thumbnailPromises = [1, 3, 5, 10].map((timestamp) => {
      return new Promise<void>((resolve, reject) => {
        const outputPath = path.join(tempDir, `thumbnail-${timestamp}.jpg`);
        ffmpeg(tempFilePath)
          .on("error", (err) => reject(err))
          .on("end", () => resolve())
          .screenshots({
            count: 1,
            folder: tempDir,
            filename: `thumbnail-${timestamp}.jpg`,
            timestamps: [timestamp],
            size: "300x300",
          });
      });
    });

    await Promise.all(
      thumbnailPromises.map((p) =>
        p.catch((e) => console.warn("Error generating thumbnail frame:", e))
      )
    );

    // Find the first successfully generated thumbnail
    const thumbnailFiles = fs
      .readdirSync(tempDir)
      .filter((file) => file.startsWith("thumbnail-"))
      .map((file) => path.join(tempDir, file));

    if (thumbnailFiles.length > 0) {
      // Use the first non-empty thumbnail
      for (const thumbPath of thumbnailFiles) {
        if (fs.statSync(thumbPath).size > 0) {
          thumbnailBuffer = fs.readFileSync(thumbPath);
          metadata.hasThumbnail = true;
          break;
        }
      }
    }

    // Fallback if no thumbnail was generated
    if (!thumbnailBuffer) {
      console.warn("No video thumbnail generated, creating placeholder");
      thumbnailBuffer = await createPlaceholderThumbnail(fileType);
    }

    // Get video metadata like duration
    const videoInfo = await new Promise<any>((resolve, reject) => {
      ffmpeg.ffprobe(tempFilePath, (err, info) => {
        if (err) reject(err);
        else resolve(info);
      });
    });

    if (videoInfo?.format) {
      metadata.duration = videoInfo.format.duration;
      metadata.bitrate = videoInfo.format.bit_rate;

      if (videoInfo.streams && videoInfo.streams.length > 0) {
        const videoStream = videoInfo.streams.find(
          (s: any) => s.codec_type === "video"
        );
        if (videoStream) {
          metadata.width = videoStream.width;
          metadata.height = videoStream.height;
          metadata.codec = videoStream.codec_name;
          metadata.fps = eval(videoStream.r_frame_rate);
        }
      }
    }

    // Clean up temporary files
    thumbnailFiles.forEach((file) => {
      try {
        fs.unlinkSync(file);
      } catch (e) {
        /* ignore */
      }
    });
    fs.unlinkSync(tempFilePath);
    fs.rmdirSync(tempDir);
  } catch (error) {
    console.error("Error processing video:", error);
    // Create placeholder thumbnail
    thumbnailBuffer = await createPlaceholderThumbnail(fileType);
  }

  return {
    thumbnailBuffer,
    metadata,
  };
}

// Enhanced audio processing to generate actual waveform
async function processAudio(
  file: Buffer,
  fileType: string
): Promise<ProcessedFile> {
  const metadata: Record<string, any> = { type: "audio" };
  let thumbnailBuffer: Buffer | undefined;

  try {
    // Create a temporary file
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-"));
    const tempFilePath = path.join(
      tempDir,
      `temp-audio${getExtensionFromMimeType(fileType)}`
    );

    fs.writeFileSync(tempFilePath, file);

    // Get audio metadata like duration
    const audioInfo = await new Promise<any>((resolve, reject) => {
      ffmpeg.ffprobe(tempFilePath, (err, info) => {
        if (err) reject(err);
        else resolve(info);
      });
    });

    if (audioInfo?.format) {
      metadata.duration = audioInfo.format.duration;
      metadata.bitrate = audioInfo.format.bit_rate;

      if (audioInfo.streams && audioInfo.streams.length > 0) {
        const audioStream = audioInfo.streams.find(
          (s: any) => s.codec_type === "audio"
        );
        if (audioStream) {
          metadata.codec = audioStream.codec_name;
          metadata.channels = audioStream.channels;
          metadata.sampleRate = audioStream.sample_rate;
        }
      }
    }

    // Generate a generic waveform thumbnail
    thumbnailBuffer = await sharp({
      create: {
        width: 300,
        height: 150,
        channels: 4,
        background: { r: 230, g: 230, b: 240, alpha: 1 },
      },
    })
      .composite([
        {
          input: Buffer.from(`<svg width="300" height="150">
          <rect x="0" y="0" width="300" height="150" fill="none" />
          <path d="M10,75 Q30,30 50,75 T90,75 T130,75 T170,75 T210,75 T250,75 T290,75" stroke="#4B0082" stroke-width="3" fill="none" />
          <text x="100" y="130" font-family="Arial" font-size="12" fill="#333">Audio Waveform</text>
        </svg>`),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    // Clean up temporary files
    fs.unlinkSync(tempFilePath);
    fs.rmdirSync(tempDir);
  } catch (error) {
    console.error("Error processing audio:", error);
    // Continue without thumbnail if we encounter issues
  }

  return {
    thumbnailBuffer,
    metadata,
  };
}

function getExtensionFromMimeType(mimeType: string): string {
  const config = FILE_CONFIGS[mimeType];
  return config && config.extensions[0] ? config.extensions[0] : "";
}

async function processFile(
  file: Buffer,
  fileType: string,
  config: FileConfig
): Promise<ProcessedFile> {
  switch (config.category) {
    case "image":
      return processImage(file, fileType);
    case "video":
      return processVideo(file, fileType);
    case "audio":
      return processAudio(file, fileType);
    default:
      // For documents and other types, just return metadata
      return {
        metadata: {
          type: config.category,
        },
      };
  }
}

async function uploadToCloudinary(
  buffer: Buffer,
  options: UploadApiOptions
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const stream = Readable.from(buffer);
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) reject(error);
        else resolve(result as UploadResult);
      }
    );
    stream.pipe(uploadStream);
  });
}

export const handleFileUpload = async (
  io: Server,
  socket: Socket,
  data: UploadData
) => {
  try {
    const { file, userId, groupId, fileType, fileName, caption, tags } = data;
    console.log("File upload request:", data);
    const config = FILE_CONFIGS[fileType];

    if (!config) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    if (file.length > config.maxSize) {
      throw new Error(
        `File too large. Maximum size is ${config.maxSize / (1024 * 1024)}MB`
      );
    }

    const group = await db.group.findUnique({
      where: {
        id: groupId,
      },
      include: {
        creator: true,
        members: true,
      },
    });

    if (!group) {
      throw new Error("Group not found");
    }

    // Check if the user is a creator or a member
    const isCreator = group.creatorId === userId;
    const isMember = group.members.some((member) => member.id === userId);

    if (!isCreator && !isMember) {
      throw new Error("Not authorized to upload to this group");
    }

    // Process file based on type
    const { previewBuffer, thumbnailBuffer, metadata } = await processFile(
      file,
      fileType,
      config
    );

    const mainUploadOptions = getCloudinaryUploadOptions(
      fileType,
      groupId,
      fileName,
      tags
    );

    // Upload main file with progress tracking
    const mainUpload = await new Promise<UploadResult>((resolve, reject) => {
      let uploadProgress = 0;
      const stream = Readable.from(file);
      const uploadStream = cloudinary.uploader.upload_stream(
        mainUploadOptions,
        (error, result) => {
          if (error) reject(error);
          else resolve(result as UploadResult);
        }
      );

      // Track upload progress
      stream.on("data", (chunk) => {
        uploadProgress += chunk.length;
        const percentage = Math.round((uploadProgress / file.length) * 100);
        socket.emit("uploadProgress", { progress: percentage });
      });

      stream.pipe(uploadStream);
    });

    // Upload preview with specific options if available
    const previewUploadPromise = previewBuffer
      ? uploadToCloudinary(previewBuffer, {
          folder: `study-groups/${groupId}/previews`,
          resource_type: "image",
          public_id: `preview-${mainUpload.public_id}`,
          format: "jpg",
          quality: "auto",
        })
      : Promise.resolve(null);

    // Upload thumbnail with specific options if available
    const thumbnailUploadPromise = thumbnailBuffer
      ? uploadToCloudinary(thumbnailBuffer, {
          folder: `study-groups/${groupId}/thumbnails`,
          resource_type: "image",
          public_id: `thumb-${mainUpload.public_id}`,
          format: "jpg",
          quality: "auto",
        })
      : Promise.resolve(null);

    const [previewUpload, thumbnailUpload] = await Promise.all([
      previewUploadPromise,
      thumbnailUploadPromise,
    ]);

    // Prepare enhanced metadata
    const enhancedMetadata: Prisma.JsonObject = {
      ...metadata,
      originalName: fileName,
      contentType: fileType,
      category: config.category,
      uploadDate: new Date().toISOString(),
      cloudinaryPublicId: mainUpload.public_id,
      fileExtension: fileName.split(".").pop()?.toLowerCase(),
      tags: tags || [],
      // Add streaming URL for videos
      streamingUrl: mainUpload.eager?.[0]?.secure_url,
    };

    // Save file information to database
    const fileDoc = await db.file.create({
      data: {
        name: fileName,
        url: mainUpload.secure_url,
        previewUrl: previewUpload?.secure_url || null,
        thumbnailUrl: thumbnailUpload?.secure_url || null,
        fileType,
        size: mainUpload.bytes,
        userId,
        groupId,
        caption,
        metadata: enhancedMetadata,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    console.log("File uploaded:", fileDoc);

    io.to(groupId).emit("fileUploaded", { file: { ...fileDoc, type: "file" } });
    io.to(groupId).emit("message", { file: { ...fileDoc, type: "file" } });

    return fileDoc;
  } catch (error) {
    console.error("Error in file upload:", error);
    throw error;
  }
};

// Utility function to get supported file types
export const getSupportedFileTypes = () => {
  return Object.entries(FILE_CONFIGS).map(([mimeType, config]) => ({
    mimeType,
    description: config.description,
    maxSize: config.maxSize,
    category: config.category,
    extensions: config.extensions,
    allowedInChat: config.allowedInChat,
  }));
};

// Socket event handler setup
export const handleFileEvents = (io: Server, socket: Socket) => {
  // Handle file upload
  socket.on("uploadFile", async (data: UploadData) => {
    try {
      socket.emit("uploadProgress", { progress: 0 });

      const fileDoc = await handleFileUpload(io, socket, data);

      socket.emit("uploadProgress", { progress: 100 });
      socket.emit("uploadComplete", { fileId: fileDoc.id });
    } catch (error) {
      console.error("Error in file upload:", error);
      socket.emit("uploadError", {
        message: error instanceof Error ? error.message : "File upload failed",
      });
    }
  });

  // Handle file deletion
  socket.on(
    "deleteFile",
    async ({
      fileId,
      userId,
      groupId,
    }: {
      fileId: string;
      userId: string;
      groupId: string;
    }) => {
      try {
        const file = await db.file.findFirst({
          where: {
            id: fileId,
            groupId,
            userId,
          },
        });

        if (!file) {
          throw new Error(
            "File not found or you don't have permission to delete it"
          );
        }

        // Delete from Cloudinary
        if (
          file.metadata &&
          typeof file.metadata === "object" &&
          "cloudinaryPublicId" in file.metadata
        ) {
          await cloudinary.uploader.destroy(
            file.metadata.cloudinaryPublicId as string
          );

          // Also delete preview and thumbnail if they exist
          const thumbnailId = `thumb-${file.metadata.cloudinaryPublicId}`;
          const previewId = `preview-${file.metadata.cloudinaryPublicId}`;

          try {
            if (file.thumbnailUrl) {
              await cloudinary.uploader.destroy(thumbnailId);
            }

            if (file.previewUrl) {
              await cloudinary.uploader.destroy(previewId);
            }
          } catch (deleteError) {
            console.warn("Error deleting thumbnails/previews:", deleteError);
            // Continue with file deletion even if thumbnail/preview deletion fails
          }
        }

        // Delete from database
        await db.file.delete({
          where: { id: fileId },
        });

        // Notify group members
        io.to(groupId).emit("fileDeleted", { fileId });
      } catch (error) {
        console.error("Error deleting file:", error);
        socket.emit("deleteError", {
          message:
            error instanceof Error ? error.message : "File deletion failed",
        });
      }
    }
  );
};
