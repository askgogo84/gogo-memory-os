import Image from "next/image";

// WhatsApp deep link. NEXT_PUBLIC_ASKGOGO_WA_NUMBER is inlined at build time; if
// it isn't set for this app we fall back to the marketing site.
const waNumber = process.env.NEXT_PUBLIC_ASKGOGO_WA_NUMBER?.replace(/\D/g, "");
const ctaHref = waNumber
  ? `https://wa.me/${waNumber}?text=${encodeURIComponent("Hi Gogo")}`
  : "https://askgogo.in";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#fbf6ef] px-6 py-24 font-sans text-[#0B141A]">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 text-center">
        <Image
          src="/askgogo-mark.svg"
          alt="AskGogo"
          width={88}
          height={88}
          priority
        />
        <div className="flex flex-col gap-4">
          <h1 className="text-5xl font-semibold tracking-tight">AskGogo</h1>
          <p className="text-lg leading-8 text-[#0B141A]/70">
            Your AI assistant that lives in WhatsApp — reminders, memory,
            calendar, money and health, no app and no login, just a message.
          </p>
        </div>
        <a
          href={ctaHref}
          className="inline-flex h-12 items-center justify-center rounded-full bg-[#12B85C] px-7 text-base font-medium text-white transition-colors hover:bg-[#0FA050]"
        >
          Message Gogo on WhatsApp
        </a>
      </main>
    </div>
  );
}
