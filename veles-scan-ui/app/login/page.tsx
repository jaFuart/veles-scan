import { LoginView } from "@/components/auth/LoginView";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  return <LoginView error={query.error} />;
}
