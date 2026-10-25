import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    console.log("Paperclip Task:", body);

    const text =
      body?.input ||
      body?.task ||
      body?.issue?.title ||
      "No input received";

    return NextResponse.json({
      success: true,
      result: `Processed: ${text}`,
    });
  } catch (err: any) {
    console.error(err);

    return NextResponse.json(
      { success: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
