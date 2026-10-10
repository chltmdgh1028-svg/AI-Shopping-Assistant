import { ShoppingApp } from "@/components/ShoppingApp";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  return <ShoppingApp initialAuthTransition={shouldStartInAuthTransition(params)} />;
}

function shouldStartInAuthTransition(params: Record<string, string | string[] | undefined>) {
  if (first(params.auth_callback) === "success") return true;
  if (first(params.auth_error) !== "provider_error") return false;
  const text = [params.provider_error, params.provider_error_code, params.provider_error_description].map(first).filter(Boolean).join(" ").toLowerCase();
  return /(identity|user|account).*(exist|already|linked|conflict)|already.*(exist|linked)|conflict|duplicate/.test(text);
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
