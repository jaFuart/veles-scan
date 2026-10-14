import { redirect } from "next/navigation";
import { getCurrentViewer } from "@/lib/auth";

export default async function Home() {
  const viewer = await getCurrentViewer();
  if (viewer) {
    redirect("/projects");
  }

  redirect("/login");
}
