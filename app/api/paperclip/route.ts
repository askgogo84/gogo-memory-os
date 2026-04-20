import { NextResponse } from "next/server";

export async function POST(req) {
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
      result: Processed: 
    });

  } catch (err) {
    console.error(err);

    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
