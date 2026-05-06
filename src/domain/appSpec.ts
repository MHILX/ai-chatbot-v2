import { z } from "zod";

export const appTypes = ["dashboard", "workflow", "crud", "chatbot", "portal", "other"] as const;

export const appSpecSchema = z.object({
  appName: z.string().trim().min(1).optional().nullable(),
  purpose: z.string().trim().min(1).optional().nullable(),
  appType: z.enum(appTypes).optional().nullable(),
  targetUsers: z.array(z.string().trim().min(1)).default([]),
  coreFeatures: z.array(z.string().trim().min(1)).default([]),
  dataEntities: z.array(z.string().trim().min(1)).default([]),
  integrations: z.array(z.string().trim().min(1)).default([]),
  authRequired: z.boolean().optional().nullable(),
  deploymentTarget: z.string().trim().min(1).optional().nullable(),
  roles: z.array(z.string().trim().min(1)).default([]),
  permissions: z.array(z.string().trim().min(1)).default([]),
  reportingNeeds: z.array(z.string().trim().min(1)).default([]),
  workflowSteps: z.array(z.string().trim().min(1)).default([]),
  notes: z.array(z.string().trim().min(1)).default([])
});

export const partialAppSpecSchema = z.object({
  appName: z.string().trim().min(1).optional().nullable(),
  purpose: z.string().trim().min(1).optional().nullable(),
  appType: z.enum(appTypes).optional().nullable(),
  targetUsers: z.array(z.string().trim().min(1)).optional(),
  coreFeatures: z.array(z.string().trim().min(1)).optional(),
  dataEntities: z.array(z.string().trim().min(1)).optional(),
  integrations: z.array(z.string().trim().min(1)).optional(),
  authRequired: z.boolean().optional().nullable(),
  deploymentTarget: z.string().trim().min(1).optional().nullable(),
  roles: z.array(z.string().trim().min(1)).optional(),
  permissions: z.array(z.string().trim().min(1)).optional(),
  reportingNeeds: z.array(z.string().trim().min(1)).optional(),
  workflowSteps: z.array(z.string().trim().min(1)).optional(),
  notes: z.array(z.string().trim().min(1)).optional()
});

export type AppType = (typeof appTypes)[number];
export type AppSpec = z.infer<typeof appSpecSchema>;
export type PartialAppSpec = z.infer<typeof partialAppSpecSchema>;
export type AppSpecField = keyof AppSpec;

export function createEmptyAppSpec(): AppSpec {
  return appSpecSchema.parse({});
}
