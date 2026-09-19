import Image from "next/image";

const ctaHref = "https://askgogo.in";

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
            Your personal AI that remembers, plans, acts and keeps working when
            you&apos;re away.
          </p>
        </div>
        <a
          href={ctaHref}
          className="inline-flex h-12 items-center justify-center rounded-full bg-[#12B85C] px-7 text-base font-medium text-white transition-colors hover:bg-[#0FA050]"
        >
          Join Gogo
        </a>
      </main>
    </div>
  );
}
