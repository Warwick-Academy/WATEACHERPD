import { createServiceRoleClient } from "@/lib/supabase/server"
import { getStripeClient } from "@/lib/payments/stripe"
import { NextResponse } from "next/server"
import { headers } from "next/headers"
import Stripe from "stripe"

async function reportExistingEnrollment(client: ReturnType<typeof createServiceRoleClient>, userId: string, courseId: number) {
  const { data, error } = await client.from("enrollments").select("status").eq("user_id", userId).eq("course_id", courseId).maybeSingle()
  if (error || !data) {
    console.error("Could not verify existing enrollment after payment:", error)
    return false
  }
  if (data.status === "cancelled") {
    console.error("Payment received for a cancelled assignment; administrator review is required.", { userId, courseId })
  }
  return true
}

export async function POST(request: Request) {
  const body = await request.text()
  const headersList = await headers()
  const signature = headersList.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    const stripe = getStripeClient()
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 })
  }

  const serviceSupabase = createServiceRoleClient()

  // Handle Payment Intent (legacy, for embedded forms)
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    const { userId, courseId, amountUSD } = paymentIntent.metadata

    // Create payment record
      const { data: paymentData } = await serviceSupabase.from("payments").insert({
        user_id: userId,
        course_id: parseInt(courseId),
        payment_amount: paymentIntent.amount / 100,
        payment_currency: paymentIntent.currency.toUpperCase(),
        exchange_rate: paymentIntent.amount / 100 / parseFloat(amountUSD),
        gateway: "stripe",
        status: "completed",
        transaction_id: paymentIntent.id,
        payment_method: paymentIntent.payment_method_types[0],
        completed_at: new Date().toISOString(),
      }).select().single()

    // Send payment confirmation email notification (non-blocking)
    if (paymentData?.id) {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
        const notificationUrl = new URL("/api/send-email-notification", baseUrl).toString()
        fetch(notificationUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "payment",
            paymentId: paymentData.id.toString(),
            status: "completed",
          }),
        }).catch((error) => {
          console.error("Failed to trigger payment email:", error)
        })
      } catch (urlError) {
        console.error("Failed to construct notification URL:", urlError)
      }
    }

    // Create enrollment
    const { data: enrollmentData, error: enrollmentError } = await serviceSupabase.from("enrollments").upsert({
      user_id: userId,
      course_id: parseInt(courseId),
      status: "active",
      progress: 0,
    }, { onConflict: "user_id,course_id", ignoreDuplicates: true }).select().maybeSingle()
    if (enrollmentError) {
      console.error("Failed to create enrollment after payment:", enrollmentError)
      return NextResponse.json({ error: "Failed to create enrollment after payment" }, { status: 500 })
    }
    if (!enrollmentData && !await reportExistingEnrollment(serviceSupabase, userId, parseInt(courseId))) {
      return NextResponse.json({ error: "Failed to verify enrollment after payment" }, { status: 500 })
    }

    // Update enrolled_students count in courses table if enrollment was created
    if (enrollmentData) {
      const { count: currentCount, error: countError } = await serviceSupabase
        .from("enrollments")
        .select("*", { count: "exact", head: true })
        .eq("course_id", parseInt(courseId))
        .neq("status", "cancelled")

      if (countError || currentCount === null) {
        console.error("Failed to count course enrollments after payment:", countError)
      } else {
        const { error } = await serviceSupabase.from("courses").update({ enrolled_students: currentCount }).eq("id", parseInt(courseId))
        if (error) console.error("Failed to update course enrollment count after payment:", error)
      }

      // Send enrollment email notification (non-blocking)
      if (enrollmentData.id) {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
          const notificationUrl = new URL("/api/send-email-notification", baseUrl).toString()
          fetch(notificationUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "enrollment",
              enrollmentId: enrollmentData.id.toString(),
            }),
          }).catch((error) => {
            console.error("Failed to trigger enrollment email:", error)
          })
        } catch (urlError) {
          console.error("Failed to construct notification URL:", urlError)
        }
      }
    }
  }

  // Handle Checkout Session (for hosted Checkout pages)
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session
    const { userId, courseId, originalAmount, originalCurrency } = session.metadata || {}

    if (userId && courseId) {
      // Retrieve the payment intent to get amount details
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null
      
      if (paymentIntentId) {
        const stripe = getStripeClient()
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

        // Create payment record with multi-currency support
        const { data: paymentData } = await serviceSupabase.from("payments").insert({
          user_id: userId,
          course_id: parseInt(courseId),
          original_amount: parseFloat(originalAmount || "0"),
          original_currency: originalCurrency || "USD",
          payment_amount: paymentIntent.amount / 100,
          payment_currency: paymentIntent.currency.toUpperCase(),
          exchange_rate: paymentIntent.amount / 100 / parseFloat(originalAmount || "1"),
          gateway: "stripe",
          status: "completed",
          transaction_id: paymentIntent.id,
          payment_method: paymentIntent.payment_method_types[0] || "card",
          completed_at: new Date().toISOString(),
        }).select().single()

        // Send payment confirmation email notification (non-blocking)
        if (paymentData?.id) {
          try {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
            const notificationUrl = new URL("/api/send-email-notification", baseUrl).toString()
            fetch(notificationUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "payment",
                paymentId: paymentData.id.toString(),
                status: "completed",
              }),
            }).catch((error) => {
              console.error("Failed to trigger payment email:", error)
            })
          } catch (urlError) {
            console.error("Failed to construct notification URL:", urlError)
          }
        }

        // Create enrollment
        const { data: enrollmentData, error: enrollmentError } = await serviceSupabase.from("enrollments").upsert({
          user_id: userId,
          course_id: parseInt(courseId),
          status: "active",
          progress: 0,
        }, { onConflict: "user_id,course_id", ignoreDuplicates: true }).select().maybeSingle()
        if (enrollmentError) {
          console.error("Failed to create enrollment after payment:", enrollmentError)
          return NextResponse.json({ error: "Failed to create enrollment after payment" }, { status: 500 })
        }
        if (!enrollmentData && !await reportExistingEnrollment(serviceSupabase, userId, parseInt(courseId))) {
          return NextResponse.json({ error: "Failed to verify enrollment after payment" }, { status: 500 })
        }

        // Update enrolled_students count in courses table if enrollment was created
        if (enrollmentData) {
          const { count: currentCount, error: countError } = await serviceSupabase
            .from("enrollments")
            .select("*", { count: "exact", head: true })
            .eq("course_id", parseInt(courseId))
            .neq("status", "cancelled")

          if (countError || currentCount === null) {
            console.error("Failed to count course enrollments after payment:", countError)
          } else {
            const { error } = await serviceSupabase.from("courses").update({ enrolled_students: currentCount }).eq("id", parseInt(courseId))
            if (error) console.error("Failed to update course enrollment count after payment:", error)
          }

          // Send enrollment email notification (non-blocking)
          if (enrollmentData.id) {
            try {
              const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
              const notificationUrl = new URL("/api/send-email-notification", baseUrl).toString()
              fetch(notificationUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "enrollment",
                  enrollmentId: enrollmentData.id.toString(),
                }),
              }).catch((error) => {
                console.error("Failed to trigger enrollment email:", error)
              })
            } catch (urlError) {
              console.error("Failed to construct notification URL:", urlError)
            }
          }
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}

