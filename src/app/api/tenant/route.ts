import { NextRequest, NextResponse } from 'next/server';
import { getTenantProfile, updateTenantProfile, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const GET = withApiAuth(
  async () => {
    try {
      const profile = await getTenantProfile();
      return NextResponse.json(profile);
    } catch (error) {
      console.error('Failed to fetch tenant profile:', error);
      return NextResponse.json({ message: 'Failed to fetch workspace' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const PATCH = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const update: Parameters<typeof updateTenantProfile>[0] = {};

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) {
          return NextResponse.json({ message: 'Workspace name cannot be empty' }, { status: 400 });
        }
        update.name = name;
      }

      if (body.logoUrl !== undefined) {
        update.logoUrl = body.logoUrl ? String(body.logoUrl).trim() : null;
      }

      if (body.timezone !== undefined) {
        const timezone = String(body.timezone).trim();
        if (!isValidTimezone(timezone)) {
          return NextResponse.json({ message: `"${timezone}" is not a recognized timezone` }, { status: 400 });
        }
        update.timezone = timezone;
      }

      if (body.businessDescription !== undefined) {
        update.businessDescription = body.businessDescription ? String(body.businessDescription).trim() : null;
      }

      if (body.supportEmail !== undefined) {
        const supportEmail = body.supportEmail ? String(body.supportEmail).trim() : '';
        if (supportEmail && !EMAIL_RE.test(supportEmail)) {
          return NextResponse.json({ message: 'Support email is not a valid email address' }, { status: 400 });
        }
        update.supportEmail = supportEmail || null;
      }

      if (body.notificationSettings !== undefined) {
        const ns = body.notificationSettings || {};
        update.notificationSettings = {
          notifyEmail: ns.notifyEmail ? String(ns.notifyEmail).trim() : undefined,
          emailOnNewConversation: !!ns.emailOnNewConversation,
          emailOnHandoffRequested: !!ns.emailOnHandoffRequested,
          emailDailyDigest: !!ns.emailDailyDigest,
        };
      }

      const profile = await updateTenantProfile(update);

      await addLog({
        user: ctx.userId || 'Administrator',
        action: 'Workspace Settings Updated',
        details: `Updated ${Object.keys(update).join(', ') || 'workspace'} settings`,
        type: 'info',
      });

      return NextResponse.json(profile);
    } catch (error: any) {
      console.error('Failed to update tenant profile:', error);
      return NextResponse.json({ message: error.message || 'Failed to update workspace' }, { status: 400 });
    }
  },
  { roles: ['admin'] }
);
