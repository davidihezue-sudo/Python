import nodemailer, { type Transporter } from "nodemailer";
import { db } from "./db";
import { env, smtpEnabled } from "./env";
import { logger } from "./logger";

let transport: Transporter | null = null;
function getTransport() {
  if (!smtpEnabled()) return null;
  const e = env();
  transport ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
  });
  return transport;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  const row = await db.emailOutbox.create({ data: { toEmail: to, subject, text, html: html ?? null } });
  const t = getTransport();
  if (!t) {
    // No SMTP configured: keep the message in the outbox (visible in development at /dev/outbox) and the server log.
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: "LOGGED" } });
    logger.info({ to, subject }, "email logged (SMTP not configured)");
    return { id: row.id, delivered: false };
  }
  try {
    await t.sendMail({ from: env().EMAIL_FROM, to, subject, text, html });
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
    return { id: row.id, delivered: true };
  } catch (e) {
    await db.emailOutbox.update({ where: { id: row.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: (e as Error).message.slice(0, 500) } });
    logger.warn({ to, err: (e as Error).message }, "email delivery failed");
    return { id: row.id, delivered: false };
  }
}

/** Retry FAILED/PENDING outbox rows (called by the background job). */
export async function flushOutbox(limit = 50) {
  const t = getTransport();
  if (!t) return { sent: 0, failed: 0 };
  const rows = await db.emailOutbox.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 5 } }, take: limit, orderBy: { createdAt: "asc" } });
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await t.sendMail({ from: env().EMAIL_FROM, to: r.toEmail, subject: r.subject, text: r.text, html: r.html ?? undefined });
      await db.emailOutbox.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
      sent++;
    } catch (e) {
      await db.emailOutbox.update({ where: { id: r.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: (e as Error).message.slice(0, 500) } });
      failed++;
    }
  }
  return { sent, failed };
}

const layout = (title: string, bodyHtml: string) =>
  `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111"><h2 style="margin:0 0 16px">AutoVault</h2><h3>${esc(title)}</h3>${bodyHtml}<p style="color:#666;font-size:12px;margin-top:32px">You received this because of activity on your AutoVault account.</p></div>`;

export const appUrl = (path: string) => `${env().APP_URL.replace(/\/$/, "")}${path}`;

export function verifyEmailMessage(name: string, token: string) {
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  return {
    subject: "Verify your AutoVault email",
    text: `Hi ${name},\n\nConfirm your email address to finish setting up AutoVault:\n${link}\n\nThis link expires in 24 hours. If you didn't create an account, ignore this email.`,
    html: layout("Verify your email", `<p>Hi ${esc(name)}, confirm your email to finish setting up your account.</p><p><a href="${link}">Verify email</a></p><p style="color:#666">Link expires in 24 hours.</p>`),
  };
}
export function resetPasswordMessage(name: string, token: string) {
  const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  return {
    subject: "Reset your AutoVault password",
    text: `Hi ${name},\n\nUse this link to choose a new password:\n${link}\n\nThe link expires in 1 hour. If you didn't ask for this, you can ignore this email.`,
    html: layout("Reset your password", `<p>Hi ${esc(name)}, use the link below to choose a new password.</p><p><a href="${link}">Reset password</a></p><p style="color:#666">Link expires in 1 hour.</p>`),
  };
}
export function inviteMessage(inviter: string, household: string, token: string) {
  const link = appUrl(`/invite/${encodeURIComponent(token)}`);
  return {
    subject: `${inviter} invited you to ${household} on AutoVault`,
    text: `${inviter} invited you to join the household "${household}" on AutoVault.\n\nAccept the invitation:\n${link}\n\nThe invitation expires in 7 days.`,
    html: layout("You're invited", `<p>${esc(inviter)} invited you to join the household <strong>${esc(household)}</strong>.</p><p><a href="${link}">Accept invitation</a></p>`),
  };
}
export function notificationMessage(title: string, body: string, actionPath: string | null) {
  const link = actionPath ? appUrl(actionPath) : appUrl("/dashboard");
  return {
    subject: `AutoVault: ${title}`,
    text: `${title}\n\n${body}\n\nOpen AutoVault: ${link}`,
    html: layout(title, `<p>${esc(body)}</p><p><a href="${link}">Open AutoVault</a></p>`),
  };
}
