import DeadballLab from "../deadball-lab";

export const metadata = {
  title: "xG and PSxG calculations - TactiSet",
  description: "Inspect TactiSet expected-goals and post-shot expected-goals calculations.",
};

export default function CalculationsPage() {
  return <DeadballLab view="calculations" />;
}
