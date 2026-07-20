import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  confirmedMenuPriceSchema,
  menuImageMimeTypes,
  menuMealRecommendationResponseSchema,
} from "@/lib/menu-meal-recommendations";
import { mealRecommendationQuickTags } from "@/lib/meal-recommendations";
import { runMenuMealRecommendation } from "@/server/workflows/menu-meal-recommendation";
import { requireApiUser } from "@/server/auth";
import { createSkillReadStore } from "@/server/skill-read-store";

export const runtime = "nodejs";

const maxImageBytes = 6 * 1024 * 1024;
const totalTimeoutMs = 55_000;
const quickTagsSchema = z.array(z.enum(mealRecommendationQuickTags)).max(mealRecommendationQuickTags.length);
const confirmedPricesSchema = z.union([
  z.array(confirmedMenuPriceSchema).max(100),
  z.record(z.string().trim().min(1).max(100), z.number().int().safe().positive()).transform((prices) => Object.entries(prices).map(([temporaryId, priceCents]) => ({ temporaryId, priceCents }))),
]);
type SupportedMimeType = (typeof menuImageMimeTypes)[number];

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

class WorkflowTimeoutError extends Error {
  constructor() {
    super("菜单识别和推荐超过55秒，请重试或改用菜单文字");
    this.name = "WorkflowTimeoutError";
  }
}

export async function withMenuWorkflowTimeout<T>(promise: Promise<T>, timeoutMs = totalTimeoutMs): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new WorkflowTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parseJsonField(value: FormDataEntryValue | null, fallback: unknown, fieldName: string): unknown {
  if (value === null || value === "") return fallback;
  if (typeof value !== "string") throw new RequestError(400, "VALIDATION_ERROR", `${fieldName}必须是JSON字符串`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new RequestError(400, "VALIDATION_ERROR", `${fieldName}不是有效JSON`);
  }
}

function hasValidMagic(bytes: Uint8Array, mimeType: SupportedMimeType) {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxImageBytes + 128 * 1024) {
      throw new RequestError(413, "IMAGE_TOO_LARGE", "图片不能超过6MB");
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new RequestError(415, "UNSUPPORTED_MEDIA_TYPE", "请使用multipart/form-data上传菜单");
    }
    const formData = await request.formData();
    const imageValue = formData.get("image");
    const menuTextValue = formData.get("menuText");
    const image = imageValue instanceof File ? imageValue : null;
    const menuText = typeof menuTextValue === "string" ? menuTextValue.trim() : "";
    if (Boolean(image) === Boolean(menuText)) throw new RequestError(400, "INVALID_SOURCE", "image和menuText必须且只能提供一个");

    const quickTags = quickTagsSchema.parse(parseJsonField(formData.get("quickTags"), [], "quickTags"));
    const userRequest = z.string().trim().max(300).parse(formData.get("userRequest") ?? "");
    const skipAgentInterpretation = formData.get("skipAgentInterpretation") === "true";
    const confirmedPrices = confirmedPricesSchema.parse(parseJsonField(formData.get("confirmedPrices"), [], "confirmedPrices"));
    let source: { type: "image"; image: string; mimeType: SupportedMimeType } | { type: "menuText"; menuText: string };
    if (image) {
      if (image.size === 0) throw new RequestError(400, "EMPTY_IMAGE", "图片不能为空");
      if (image.size > maxImageBytes) throw new RequestError(413, "IMAGE_TOO_LARGE", "图片不能超过6MB");
      const mimeType = z.enum(menuImageMimeTypes).safeParse(image.type.toLowerCase());
      if (!mimeType.success) throw new RequestError(415, "UNSUPPORTED_IMAGE_TYPE", "仅支持JPEG、PNG或WebP图片");
      const bytes = new Uint8Array(await image.arrayBuffer());
      if (!hasValidMagic(bytes, mimeType.data)) throw new RequestError(415, "INVALID_IMAGE_CONTENT", "图片内容与声明格式不匹配");
      source = { type: "image", image: Buffer.from(bytes).toString("base64"), mimeType: mimeType.data };
    } else {
      source = { type: "menuText", menuText };
    }

    const result = await withMenuWorkflowTimeout(runMenuMealRecommendation({ source, quickTags, userRequest, skipAgentInterpretation, confirmedPrices }, { store: createSkillReadStore(user.id) }));
    if (!result.success) {
      const timeout = result.error.code === "MENU_RECOGNITION_TIMEOUT";
      const unavailable = result.error.code === "MENU_RECOGNITION_NOT_CONFIGURED" || result.error.code === "MENU_RECOGNITION_UPSTREAM_ERROR";
      const status = timeout ? 504 : result.error.code === "INVALID_INPUT" ? 400 : unavailable ? 503 : 500;
      return NextResponse.json({ error: result.error, retryable: timeout || result.error.code === "MENU_RECOGNITION_UPSTREAM_ERROR" }, { status });
    }
    return NextResponse.json(menuMealRecommendationResponseSchema.parse(result.data));
  } catch (error) {
    if (error instanceof RequestError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof WorkflowTimeoutError) {
      return NextResponse.json({ error: { code: "MENU_RECOMMENDATION_TIMEOUT", message: error.message }, retryable: true }, { status: 504 });
    }
    const validation = error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError;
    return NextResponse.json({ error: { code: validation ? "VALIDATION_ERROR" : "MENU_RECOMMENDATION_ERROR", message: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "菜单推荐失败" } }, { status: validation ? 400 : 500 });
  }
}
