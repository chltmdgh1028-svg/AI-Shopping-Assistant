import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const providerError = {
    error: url.searchParams.get("error"),
    errorCode: url.searchParams.get("error_code"),
    errorDescription: url.searchParams.get("error_description"),
    errorUri: url.searchParams.get("error_uri"),
  };
  const next = sanitizeNext(url.searchParams.get("next")) ?? "/";

  if (providerError.error || providerError.errorCode) return redirectWithAuthError(url, "provider_error", providerError);
  if (!code) return redirectWithAuthError(url, "missing_code");

  const supabase = await createSupabaseServerClient();
  const exchanged = await supabase?.auth.exchangeCodeForSession(code);
  if (exchanged?.error) return redirectWithAuthError(url, "exchange_failed");

  const userResult = await supabase?.auth.getUser();
  const user = userResult?.data.user;
  if (userResult?.error || !user) return redirectWithAuthError(url, "missing_user");

  const providers = user.identities?.map((identity) => identity.provider) ?? [];
  console.info("Kakao auth callback exchanged", {
    hasUser: Boolean(user),
    userId: user.id,
    isAnonymous: user.is_anonymous,
    providers,
  });

  const hasKakao = providers.includes("kakao");
  if (!hasKakao) return redirectWithAuthError(url, "missing_kakao_identity");
  if (user.is_anonymous) return redirectWithAuthError(url, "still_anonymous_after_kakao");

  url.pathname = next;
  url.search = "?auth_callback=success";
  return NextResponse.redirect(url);
}

function sanitizeNext(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function redirectWithAuthError(
  url: URL,
  reason: string,
  providerError?: {
    error: string | null;
    errorCode: string | null;
    errorDescription: string | null;
    errorUri: string | null;
  },
) {
  url.pathname = "/";
  const params = new URLSearchParams({ auth_error: reason });
  if (providerError?.error) params.set("provider_error", providerError.error);
  if (providerError?.errorCode) params.set("provider_error_code", providerError.errorCode);
  if (providerError?.errorDescription) params.set("provider_error_description", providerError.errorDescription);
  if (providerError?.errorUri) params.set("provider_error_uri", providerError.errorUri);
  url.search = params.toString();
  return NextResponse.redirect(url);
}
