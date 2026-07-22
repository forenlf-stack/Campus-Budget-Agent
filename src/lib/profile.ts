import { z } from "zod";

import { passwordSchema } from "@/lib/auth";

export const accountProfileInputSchema = z.object({
  displayName: z.string().trim().min(2, "昵称至少需要2个字符").max(40, "昵称不能超过40个字符"),
  email: z.string().trim().toLowerCase().pipe(z.email("请输入有效邮箱").max(160)),
  phone: z.string().trim().max(30, "手机号不能超过30个字符")
    .refine((value) => value === "" || /^[0-9+()\-\s]+$/.test(value), "手机号只能包含数字及常用分隔符"),
}).strict();

export const passwordChangeInputSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(128),
  newPassword: passwordSchema,
  confirmPassword: z.string().min(1, "请再次输入新密码").max(128),
}).strict().refine((input) => input.newPassword === input.confirmPassword, {
  message: "两次输入的新密码不一致",
  path: ["confirmPassword"],
});

export type AccountProfileInput = z.infer<typeof accountProfileInputSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeInputSchema>;

export interface AccountProfile extends AccountProfileInput {
  id: string;
}
