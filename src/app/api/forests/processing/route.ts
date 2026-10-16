import { NextResponse } from "next/server";
export async function POST() {
    return NextResponse.json({ error: "Forest processing is operator-only. Run the documented local Python workflow; this endpoint cannot start jobs." }, { status: 403 });
}
