const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const path = require('path');
app.use(express.static(__dirname));

// ── In-memory DB (replace with Airtable/Supabase in production) ──────────────
const db = {
  patients: [
    { id: 'p1', name: 'Priya Sharma', phone: '+91 98201 11111', dob: '1990-03-15', bloodGroup: 'O+', allergies: 'Penicillin' },
    { id: 'p2', name: 'Arjun Mehta', phone: '+91 98202 22222', dob: '1985-07-22', bloodGroup: 'A+', allergies: 'None' },
    { id: 'p3', name: 'Sunita Patel', phone: '+91 98203 33333', dob: '1972-11-08', bloodGroup: 'B+', allergies: 'Sulfa drugs' },
    { id: 'p4', name: 'Rahul Desai', phone: '+91 98204 44444', dob: '1998-01-30', bloodGroup: 'AB-', allergies: 'None' },
  ],
  appointments: [
    { id: 'a1', patientId: 'p1', patientName: 'Priya Sharma', date: '2026-04-03', time: '10:00', symptoms: 'Fever, headache', status: 'upcoming', doctorNotes: '', prescriptions: [] },
    { id: 'a2', patientId: 'p2', patientName: 'Arjun Mehta', date: '2026-04-02', time: '11:30', symptoms: 'Back pain', status: 'completed', doctorNotes: 'Muscle strain. Rest advised.', prescriptions: [{ name: 'Ibuprofen 400mg', dosage: 'Twice daily after meals', days: 5 }] },
    { id: 'a3', patientId: 'p3', patientName: 'Sunita Patel', date: '2026-04-01', time: '09:00', symptoms: 'Diabetes follow-up', status: 'completed', doctorNotes: 'Sugar levels stable. Continue medication.', prescriptions: [{ name: 'Metformin 500mg', dosage: 'Once daily', days: 30 }] },
    { id: 'a4', patientId: 'p4', patientName: 'Rahul Desai', date: '2026-04-05', time: '14:00', symptoms: 'Cough, cold', status: 'upcoming', doctorNotes: '', prescriptions: [] },
  ],
  followUps: [
    { id: 'f1', patientId: 'p2', patientName: 'Arjun Mehta', appointmentId: 'a2', sentAt: '2026-04-02T18:00:00', response: 'yes', medicineAdherence: true },
    { id: 'f2', patientId: 'p3', patientName: 'Sunita Patel', appointmentId: 'a3', sentAt: '2026-04-01T18:00:00', response: 'no', medicineAdherence: false },
  ],
  chatSessions: {}
};

// ── Analytics ─────────────────────────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  const total = db.appointments.length;
  const completed = db.appointments.filter(a => a.status === 'completed').length;
  const upcoming = db.appointments.filter(a => a.status === 'upcoming').length;
  const followUpsSent = db.followUps.length;
  const adherent = db.followUps.filter(f => f.medicineAdherence).length;
  const rebookings = db.followUps.filter(f => f.response === 'no').length;

  res.json({
    totalAppointments: total,
    completed,
    upcoming,
    followUpsSent,
    medicineAdherence: followUpsSent ? Math.round((adherent / followUpsSent) * 100) : 0,
    rebookings,
    weeklyData: [
      { day: 'Mon', appointments: 4 },
      { day: 'Tue', appointments: 6 },
      { day: 'Wed', appointments: 3 },
      { day: 'Thu', appointments: 8 },
      { day: 'Fri', appointments: 5 },
      { day: 'Sat', appointments: 7 },
      { day: 'Sun', appointments: 2 },
    ]
  });
});

// ── Appointments ──────────────────────────────────────────────────────────────
app.get('/api/appointments', (req, res) => {
  res.json(db.appointments.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

app.post('/api/appointments', (req, res) => {
  const appt = { id: uuidv4(), ...req.body, status: 'upcoming', doctorNotes: '', prescriptions: [] };
  db.appointments.push(appt);

  // Auto-add patient if new
  const exists = db.patients.find(p => p.phone === req.body.phone);
  if (!exists && req.body.patientName && req.body.phone) {
    db.patients.push({
      id: uuidv4(),
      name: req.body.patientName,
      phone: req.body.phone,
      dob: '',
      bloodGroup: '',
      allergies: ''
    });
  }
  res.json(appt);
});

app.patch('/api/appointments/:id', (req, res) => {
  const appt = db.appointments.find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  Object.assign(appt, req.body);
  res.json(appt);
});

// ── Patients ──────────────────────────────────────────────────────────────────
app.get('/api/patients', (req, res) => {
  const patientsWithHistory = db.patients.map(p => ({
    ...p,
    appointments: db.appointments.filter(a => a.patientId === p.id)
  }));
  res.json(patientsWithHistory);
});

app.get('/api/patients/:id', (req, res) => {
  const patient = db.patients.find(p => p.id === req.params.id);
  if (!patient) return res.status(404).json({ error: 'Not found' });
  const appointments = db.appointments.filter(a => a.patientId === patient.id);
  const followUps = db.followUps.filter(f => f.patientId === patient.id);
  res.json({ ...patient, appointments, followUps });
});

// ── Follow-ups ────────────────────────────────────────────────────────────────
app.get('/api/followups', (req, res) => {
  res.json(db.followUps);
});

app.post('/api/followups', (req, res) => {
  const followUp = { id: uuidv4(), sentAt: new Date().toISOString(), ...req.body };
  db.followUps.push(followUp);
  res.json(followUp);
});

// ── AI Chat (Appointment Booking + Assistant) ─────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, mode } = req.body;

  if (!db.chatSessions[sessionId]) {
    db.chatSessions[sessionId] = {
      messages: [],
      collected: {},
      mode: mode || 'booking'
    };
  }

  const session = db.chatSessions[sessionId];
  session.messages.push({ role: 'user', content: message });

  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = mode === 'doctor'
    ? `You are MedAssist AI, a helpful medical assistant for clinic doctors.
You help doctors with:
- Looking up patient history (patients: ${JSON.stringify(db.patients.map(p => ({ id: p.id, name: p.name, phone: p.phone })))})
- Summarizing appointments and prescriptions
- Suggesting follow-up actions
- Answering general medical queries
- Appointments data: ${JSON.stringify(db.appointments)}
Today is ${today}. Be concise and professional. When referencing patient data, cite specifics.`
    : `You are Medi, an AI appointment booking assistant for a medical clinic. Your job is to collect appointment details from patients in a warm, conversational way.

You need to collect:
1. Patient's full name
2. Phone number
3. Preferred date (must be a future date from today: ${today})
4. Preferred time (clinic hours: 9am–6pm)
5. Brief description of symptoms or reason for visit

Currently collected info: ${JSON.stringify(session.collected)}

Rules:
- Ask for one piece of info at a time if not yet provided
- Be warm, empathetic, and professional
- When ALL 5 fields are collected, respond with a JSON block at the END of your message in this exact format:
  BOOKING_COMPLETE:{"patientName":"...","phone":"...","date":"YYYY-MM-DD","time":"HH:MM","symptoms":"..."}
- Do not include the BOOKING_COMPLETE block until all fields are confirmed
- If patient says goodbye or cancel, respond warmly and end the session
- Keep responses short (2-3 sentences max)`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: session.messages
      })
    });

    const data = await response.json();
    const aiMessage = data.content?.[0]?.text || 'Sorry, I could not process that. Please try again.';

    session.messages.push({ role: 'assistant', content: aiMessage });

    // Check if booking is complete
    let bookingCreated = null;
    if (aiMessage.includes('BOOKING_COMPLETE:')) {
      try {
        const jsonStr = aiMessage.split('BOOKING_COMPLETE:')[1].trim();
        const bookingData = JSON.parse(jsonStr);

        // Find or create patient
        let patient = db.patients.find(p => p.phone === bookingData.phone);
        if (!patient) {
          patient = { id: uuidv4(), name: bookingData.patientName, phone: bookingData.phone, dob: '', bloodGroup: '', allergies: '' };
          db.patients.push(patient);
        }

        const appt = {
          id: uuidv4(),
          patientId: patient.id,
          patientName: bookingData.patientName,
          date: bookingData.date,
          time: bookingData.time,
          symptoms: bookingData.symptoms,
          status: 'upcoming',
          doctorNotes: '',
          prescriptions: []
        };
        db.appointments.push(appt);
        bookingCreated = appt;
      } catch (e) {
        console.error('Booking parse error:', e);
      }
    }

    // Extract collected fields for context
    const lowerMsg = message.toLowerCase();
    if (session.collected) {
      if (message.match(/\d{10}|\+91\s?\d{10}/)) session.collected.phone = message;
      if (message.match(/\d{4}-\d{2}-\d{2}/)) session.collected.date = message;
    }

    res.json({
      message: aiMessage.replace(/BOOKING_COMPLETE:.*$/s, '').trim(),
      bookingCreated,
      sessionId
    });
  } catch (err) {
    console.error('AI Error:', err);
    res.status(500).json({ error: 'AI service error', message: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.delete('/api/chat/:sessionId', (req, res) => {
  delete db.chatSessions[req.params.sessionId];
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Clinic API running on port ${PORT}`));
