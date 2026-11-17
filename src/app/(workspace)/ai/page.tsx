import { BotWorkspace } from "@/components/modules/bot-workspace";

export const metadata = {
  title: "Cyraops Bot | Cyraops CRM",
  description: "Autonomous multi-agent business operations and execution platform.",
};

export default function AiPage() {
  // When CYRAOPS_BOT_EMBED_URL is set (for example https://bot.cyraops.com) this
  // page renders the Cyraops bot workspace inline instead of the legacy in-house
  // agent console.
  //
  // Read at request time so the target can be changed by updating the container
  // environment, without rebuilding the image.
  const embedUrl = process.env.CYRAOPS_BOT_EMBED_URL?.trim();

  if (embedUrl) {
    return (
      <div className="-m-4 sm:-m-7 lg:-mx-9">
        <iframe
          src={embedUrl}
          title="Cyraops Bot"
          className="h-[calc(100dvh-62px)] w-full border-0"
          allow="clipboard-read; clipboard-write; microphone; camera; fullscreen"
        />
      </div>
    );
  }

  return <BotWorkspace />;
}
