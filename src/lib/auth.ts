import { z } from "zod";

export const passwordSchema = z.string().min(8, "密码至少需要8位").max(128, "密码不能超过128位")
  .regex(/[A-Za-z]/, "密码需要包含字母")
  .regex(/\d/, "密码需要包含数字");

export const registerInputSchema = z.object({
  displayName: z.string().trim().min(2, "昵称至少需要2个字符").max(40, "昵称不能超过40个字符"),
  email: z.email("请输入有效邮箱").trim().toLowerCase().max(160),
  password: passwordSchema,
}).strict();

export const loginInputSchema = z.object({
  email: z.email("请输入有效邮箱").trim().toLowerCase().max(160),
  password: z.string().min(1, "请输入密码").max(128),
}).strict();

export type RegisterInput = z.infer<typeof registerInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;

export interface AuthUser {
  id: string;
  displayName: string;
  email: string;
}
