# SAFETY.md — MindBridge

MindBridge is a voice AI **peer-support companion and navigator** for U.S. military veterans living with PTSD. This document is a plain, honest account of what MindBridge is, what it is not, how it handles crisis situations, how it treats your data, and where its limits are. We would rather be trusted than impressive.

---

## What MindBridge Is

- A **warm, steady companion** you can talk to out loud, like a phone call.
- A **navigator** that connects you to real human help and real local resources.
- **Honest that it is an AI.** It will tell you so, and it will not pretend to be a person.
- A place to feel **heard and validated**, and to try simple, grounded coping techniques.

## What MindBridge Is NOT

- **NOT a therapist, counselor, psychologist, or psychiatrist.**
- **NOT a doctor or medical provider.**
- **NOT a crisis or emergency service.**
- **NOT a diagnosis or treatment tool.**

MindBridge **does not diagnose** any condition, **does not prescribe or recommend medication**, **does not provide medical, clinical, or legal advice**, and **does not replace professional care of any kind.** It is a supportive companion between — and on the way to — real human help.

---

## If You Are in Crisis — Read This First

If you or someone else is in immediate danger, **call 911** (or your local emergency number).

**Veterans Crisis Line — free, confidential, 24/7:**
- **Dial 988, then press 1**
- **Text 838255**
- **Chat: [VeteransCrisisLine.net](https://www.veteranscrisisline.net)**

You do not need to be enrolled in VA benefits or health care to use it. You can reach it whether or not MindBridge is working.

---

## How Crisis Detection & Escalation Works

MindBridge continuously listens for language and signals that indicate a person may be at risk — including expressions of suicidal thoughts, self-harm, intent to harm others, or acute crisis.

When such signals are detected, MindBridge is designed to:

1. **Stop acting as a general companion** and shift into a calm, direct crisis-response posture.
2. **Not attempt to counsel, treat, or "talk the person down" on its own.** It explicitly acknowledges this is beyond what an AI should handle alone.
3. **Surface the Veterans Crisis Line and 911 immediately and prominently**, and encourage the veteran to reach a real human right now.
4. **Stay present and supportive** while the veteran connects to help, rather than ending the conversation abruptly.

### Honest limitations of crisis detection

- Crisis detection is **automated and imperfect.** It can **miss** real crises (false negatives) and can **over-trigger** on non-crisis language (false positives).
- MindBridge **cannot call for help on your behalf**, cannot contact emergency services for you, cannot dispatch anyone, and cannot verify that you reached help.
- It has **no ability to physically intervene** and cannot guarantee your safety.
- **Never rely on MindBridge as your only safeguard in an emergency.** If you are in danger, go directly to 988 (press 1) or 911.

---

## Privacy & Data Handling

We designed MindBridge to hold as little of you as possible.

- **No accounts.** You do not sign up, log in, or create a profile. We do not ask for your name, service record, or identity.
- **Conversations are not persisted server-side by default.** Your spoken conversation is processed to generate a response in the moment; by default it is **not stored on our servers** as a saved transcript tied to you.
- **Voice is processed to function.** To turn your speech into text and generate a reply, audio is transmitted to and processed by the inference and speech services that power MindBridge (including DigitalOcean Gradient inference infrastructure). This processing is necessary for the product to work.
- **Knowledge-base / resource content is generic**, not personal — the referral and coping content (including DataSF veteran resource data) is public reference data, not information about you.
- **We do not sell your data**, and we do not build advertising or marketing profiles from your conversations.

### Honest limitations of privacy

- MindBridge relies on **third-party infrastructure** (e.g., cloud inference and speech-to-text providers). Their handling of transient data is governed by their own terms, and we do not control it.
- "Not persisted by default" refers to our own servers. **Transient processing, logs needed for reliability and abuse-prevention, or diagnostic error logs may briefly exist** in the normal operation of any cloud service.
- No internet-connected system can promise perfect confidentiality. **Please do not share information you would be harmed by if it were exposed** (full legal name, SSN, financial details, precise home address).

---

## Known Limitations

- **It is an AI language model.** It can be **wrong, generic, or tone-deaf**, and it can **"hallucinate"** — state something confidently that is inaccurate. Do not treat its words as fact or professional guidance.
- **It has no memory of you between calls by default** and does not know your history, medications, or clinical situation.
- **It is not a substitute for a therapist, a VA provider, medication, a support group, or a trusted person.**
- **Resource data may be incomplete or out of date.** Availability, hours, and eligibility for listed services can change; always verify before relying on them.
- **It is English-language and U.S.-veteran oriented**, and may not serve other contexts well.
- **It cannot handle medical emergencies, legal matters, or benefits/claims decisions.**
- As a **hackathon project**, MindBridge is an early prototype. It has **not** undergone clinical validation, IRB review, or regulatory clearance, and is **not a medical device.**

---

## Disclaimer

MindBridge is an experimental peer-support companion built for the MLH x DigitalOcean "AI for Social Good" hackathon. It is **not** a medical device, **not** a healthcare provider, and **not** a crisis service, and it does **not** provide medical, psychological, or professional advice. Nothing it says should be interpreted as diagnosis, treatment, or a recommendation to take or stop any medication or care. Use of MindBridge is voluntary and at your own discretion. If you are struggling, please reach out to a qualified professional or the **Veterans Crisis Line (dial 988, then press 1; or text 838255)**. If you are in immediate danger, **call 911**. You are worth the call.
