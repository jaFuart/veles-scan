import { RegisterView } from "@/components/auth/RegisterView";

type RegisterPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const query = await searchParams;
  return <RegisterView error={query.error} />;
}
