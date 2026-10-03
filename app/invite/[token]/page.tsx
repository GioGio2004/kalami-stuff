import { AcceptInvite } from "@/components/AcceptInvite";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  return <AcceptInvite token={token} />;
}
