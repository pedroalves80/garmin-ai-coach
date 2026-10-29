import { TrainingPage } from "@/components/templates/TrainingPage";
export const metadata = { title: "Today · Run Coach" };
export default function Home() {
  return <TrainingPage view="today" />;
}
