import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'mindcare_secret';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const HAS_OPENAI_KEY = OPENAI_API_KEY && !OPENAI_API_KEY.startsWith('your_');
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
const IS_VERCEL = process.env.VERCEL === '1';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../../frontend/dist');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const db = {
  users: [], chats: {}, directChats: {}, callSignals: {}, moods: [], appointments: [], settings: {}, alerts: [], journals: []
};
const therapists = [
  { id: 't1', name: 'Dr. Grace Mwangi', title: 'Clinical Psychologist', specialty: 'Stress, anxiety, student wellness', rating: 4.9, available: true, languages: 'English, Kiswahili', phone:'+254712345678', whatsapp:'+254712345678', email:'grace.mwangi@example.com' },
  { id: 't2', name: 'Dr. Esther Njoroge', title: 'Counselling Psychologist', specialty: 'Mood support, relationships, self-esteem', rating: 4.8, available: true, languages: 'English', phone:'+254723456789', whatsapp:'+254723456789', email:'esther.njoroge@example.com' },
  { id: 't3', name: 'Dr. Amina Hassan', title: 'Mental Wellness Therapist', specialty: 'Mindfulness, depression support, trauma-informed care', rating: 4.7, available: false, languages: 'English, Kiswahili', phone:'+254734567890', whatsapp:'+254734567890', email:'amina.hassan@example.com' }
];

function publicChatId() { return 'MC-' + Math.random().toString(36).slice(2, 8).toUpperCase(); }
function ensurePublicChatId(user) {
  if (!user.publicChatId) {
    let id;
    do { id = publicChatId(); } while (db.users.some(u => u.publicChatId === id));
    user.publicChatId = id;
  }
  return user.publicChatId;
}
function publicUser(user) {
  ensurePublicChatId(user);
  return { id:user.id, chatId:user.publicChatId, name:user.name, email:user.email, role:user.role };
}
function firebaseEnabled() { return FIREBASE_API_KEY && !FIREBASE_API_KEY.startsWith('your_'); }
async function firebaseAuth(action, email, password) {
  const endpoint = action === 'register' ? 'signUp' : 'signInWithPassword';
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await response.json();
  if (!response.ok) {
    const code = data?.error?.message || 'FIREBASE_AUTH_FAILED';
    const friendly = {
      EMAIL_EXISTS: 'Email already exists',
      EMAIL_NOT_FOUND: 'No account found with that email',
      INVALID_PASSWORD: 'Invalid email or password',
      INVALID_LOGIN_CREDENTIALS: 'Invalid email or password',
      WEAK_PASSWORD: 'Password should be at least 6 characters',
      OPERATION_NOT_ALLOWED: 'Enable Email/Password sign-in in Firebase Authentication'
    }[code] || code.replaceAll('_',' ').toLowerCase();
    const error = new Error(friendly);
    error.status = code === 'EMAIL_EXISTS' ? 409 : code === 'WEAK_PASSWORD' ? 400 : 401;
    throw error;
  }
  return data;
}
function tokenFor(user) { return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' }); }
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
}
function analyzeSentiment(text = '') {
  const s = text.toLowerCase();
  const lex = {
    happy: ['happy','great','good','excited','fine','okay','love','better','grateful','calm','proud','relieved','hopeful','peaceful','awesome','amazing','niko sawa','niko poa','niko fiti','poa','sawa','freshi','fiti','nimefurahi','furaha','niko happy','nimechill','iko sawa'],
    sad: ['sad','down','empty','cry','lonely','hopeless','unhappy','depressed','heartbroken','worthless','lost','broken','miserable','hurt','tears','niko sad','nimehuzunika','huzuni','nalia','nataka kulia','mpweke','niko down','sina hope','maisha ni ngumu','najihisi vibaya','sijisikii poa','nimeumia','ameniumiza'],
    anxious: ['anxious','worried','panic','nervous','fear','scared','overthinking','afraid','restless','uneasy','tense','what if','cant stop thinking','nina anxiety','niko na anxiety','nina wasiwasi','wasiwasi','naogopa','nimepanic','niko na panic','nawaza sana','nimeoverthink','niko tense','roho inakimbia'],
    stressed: ['stress','stressed','pressure','overwhelmed','tired','fatigue','burnout','exhausted','deadline','too much','drained','busy','exam','assignment','niko stressed','niko na stress','stress imenimaliza','nimechoka','nimelemewa','kazi ni mingi','masomo ni mingi','exam inanistress','assignment inanistress','pressure ni mingi','niko burnout','nimeishiwa nguvu','noma','kunoma','kumeniramba','imekuwa mob','ni mob'],
    angry: ['angry','mad','irritated','annoyed','furious','hate','frustrated','disrespected','unfair','betrayed','nimekasirika','niko angry','nimejam','nimeboeka','ameniboo','nimeudhika','sipendi','amenidisrespect','si fair','amenibetray','imeniuma'],
    critical: ['end everything','no reason to live','give up forever','hurt myself','not want to live','kill myself','suicide','i want to die','nataka kufa','sitaki kuishi','kujitoa uhai','kujiua','najiumiza','nataka kujiumiza','maisha haina maana','sina sababu ya kuishi']
  };
  const scores = Object.fromEntries(Object.keys(lex).map(k => [k, 0]));
  for (const [mood, words] of Object.entries(lex)) {
    for (const w of words) if (s.includes(w)) scores[mood] += w.includes(' ') ? 2 : 1;
  }
  let mood = 'neutral'; let max = 0;
  for (const [k,v] of Object.entries(scores)) if (v > max) { mood = k; max = v; }
  const negative = scores.sad + scores.anxious + scores.stressed + scores.angry + scores.critical;
  const positive = scores.happy;
  const sentiment = positive > negative ? 'positive' : negative > positive ? 'negative' : 'neutral';
  const risk = scores.critical > 0 ? 'critical' : negative >= 3 ? 'high' : negative >= 1 ? 'medium' : 'low';
  const confidence = Math.min(96, 55 + max * 12 + text.length / 45);
  return { mood, sentiment, risk, confidence: Math.round(confidence), scores };
}
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function hasAny(text, words){ return words.some(w => text.includes(w)); }
function languageStyle(lower) {
  const swahiliShengWords = ['niko','nina','nime','sina','sijui','sijisikii','nataka','naogopa','nawaza','nalia','shule','masomo','mtihani','pesa','kazi','poa','sawa','fiti','freshi','noma','kunoma','mob','dem','beste','beshte','msee','mzae'];
  return hasAny(lower, swahiliShengWords) ? 'swahili_sheng' : 'english';
}
function messageIntent(lower) {
  return {
    asksAdvice: hasAny(lower, ['what should i do','advice','help me','how do i','how can i','what can i do','please help']),
    wantsComfort: hasAny(lower, ['comfort','listen','i need someone','talk to me','be with me']),
    greeting: /^(hi|hey|hello|good morning|good afternoon|good evening)\b/.test(lower.trim()),
    thanks: hasAny(lower, ['thank you','thanks','appreciate'])
  };
}
function topicContext(lower) {
  if (hasAny(lower, ['school','exam','assignment','class','lecturer','teacher','project','cat','deadline','study','shule','masomo','mtihani','mitihani','homework','coursework','unit','lec','mwalimu'])) return 'school';
  if (hasAny(lower, ['friend','girlfriend','boyfriend','relationship','family','parent','mum','mom','dad','sister','brother','beste','dem','boy wangu','mpenzi','beshte','familia','mzazi','mzae','msee','msee wangu'])) return 'relationship';
  if (hasAny(lower, ['money','fees','rent','job','work','boss','salary','pesa','fee','karo','rent','jobless','kazi','mshahara','deni','madeni'])) return 'money';
  if (hasAny(lower, ['sleep','tired','headache','sick','health','pain','usingizi','kulala','kichwa','mgonjwa','umwa','maumivu','nimechoka'])) return 'health';
  return 'general';
}
function localLanguageReply(style, topic, analysis) {
  if (style !== 'swahili_sheng') return null;
  if (analysis.risk === 'critical') {
    return 'Pole sana kwa vile unafeel. Hii ni heavy, na haupaswi kubeba peke yako. Tafadhali ongea na mtu unayemtrust, therapist, au emergency support sasa hivi kama uko kwenye danger.';
  }
  if (topic === 'school') {
    if (analysis.mood === 'stressed') return 'Naskia hiyo pressure ya masomo/exam. Tuanze polepole: ni kitu gani moja iko urgent sana leo, assignment, kusoma, ama deadline?';
    if (analysis.mood === 'anxious') return 'Inaonekana exam ama shule imekufanya uwaze sana. Ni nini inakuogopesha zaidi: kufail, time, ama hujui uanze wapi?';
    if (analysis.mood === 'sad') return 'Pole, pressure ya shule inaweza kufanya mtu afeel ako chini sana. Ni kitu gani imetokea leo ikakufanya ufeel hivyo?';
    return 'Nimekuskia kuhusu shule. Niambie kidogo, ni exam, assignment, deadline, ama pressure ya class?';
  }
  if (topic === 'relationship') {
    if (analysis.mood === 'angry') return 'Naskia umejam, na inaweza kuwa kuna kitu imekuumiza ama kukudharau. Ni nini ilihappen exactly?';
    if (analysis.mood === 'sad') return 'Pole sana. Mambo ya watu wa karibu huuma sana. Unataka kuniambia ni nini ilitokea?';
    if (analysis.mood === 'anxious') return 'Relationships zinaweza kuleta overthinking mob. Ni thought gani inarudia kichwani sana?';
    return 'Hii inasound personal. Niambie kilihappen nini, halafu tujaribu kuelewa feelings zako polepole.';
  }
  if (analysis.mood === 'stressed') return 'Naskia uko na stress mob. Chukua breath moja polepole. Ni kitu gani inakulemea zaidi right now?';
  if (analysis.mood === 'anxious') return 'Naskia wasiwasi iko juu. Tujaribu kushusha speed kidogo: ni thought gani inakusumbua zaidi?';
  if (analysis.mood === 'sad') return 'Pole sana. Hiyo feeling si rahisi. Ni nini imekufanya ufeel down leo?';
  if (analysis.mood === 'angry') return 'Naskia umejam. Kabla uchukue action, tuangalie kwanza: ni kitu gani kilikukasirisha sana?';
  if (analysis.sentiment === 'positive') return 'Hiyo ni poa kuskia. Ni kitu gani imekusaidia ufeel better leo?';
  return 'Niko hapa na wewe. Unaweza kuandika vile unafeel, hata kama ni Kiswahili, Sheng, ama mix. Ni nini iko kwa mind yako sasa?';
}
function botReply(text, analysis, history = []) {
  const lower = (text || '').toLowerCase();
  const intent = messageIntent(lower);
  const topic = topicContext(lower);
  const style = languageStyle(lower);
  const hasHistory = history.length > 2;
  const continuity = hasHistory ? ' Since we have already started talking, let us take it one step at a time.' : '';

  if (analysis.risk === 'critical') {
    return 'I am really sorry you are feeling this much pain. You should not be alone with this right now. Please contact a trusted person, emergency support, or one of the therapists in the app immediately. If you might hurt yourself, call local emergency services now.';
  }
  if (intent.greeting) {
    return pick([
      'Hey, I am here with you. How are you really feeling today?',
      'Hello. You can talk freely here. What is on your mind right now?',
      'Hi. Tell me what kind of day you are having, and we will work through it together.'
    ]);
  }
  if (intent.thanks) {
    return pick([
      'You are welcome. I am glad you shared that with me. What feels a little lighter now?',
      'Anytime. Keep going gently with yourself. What would help you for the next few minutes?',
      'I am here whenever you need to talk. What do you want to focus on next?'
    ]);
  }
  const localized = localLanguageReply(style, topic, analysis);
  if (localized) return localized;

  const topicReplies = {
    school: {
      stressed: 'School pressure can become a lot very quickly.'+continuity+' Let us choose the most urgent task first, then break it into a small step you can finish today.',
      anxious: 'It sounds like school is making your mind race. Try to name the exact worry: is it failing, time, expectations, or not knowing where to start?',
      sad: 'Academic pressure can make you feel like you are not doing enough, even when you are trying. What happened today that made it feel heavy?',
      neutral: 'I hear that this is connected to school. Tell me whether it is exams, assignments, deadlines, or class pressure so I can respond better.'
    },
    relationship: {
      angry: 'That sounds really upsetting. When someone close to you hurts or disappoints you, anger makes sense. What did they do that felt unfair?',
      sad: 'Relationship pain can sit heavily in the chest. I am sorry you are carrying that. Do you want to tell me what happened?',
      anxious: 'Relationships can trigger a lot of overthinking. What are you afraid this situation might mean?',
      neutral: 'This sounds personal. Tell me what happened, and we can separate the facts from the feelings together.'
    },
    money: {
      stressed: 'Money or work pressure can feel constant. Let us slow it down: what is the most urgent financial or work issue right now?',
      anxious: 'That kind of uncertainty can make anyone anxious. What outcome are you most worried about?',
      sad: 'I am sorry this is weighing on you. Financial or work stress can feel lonely, but we can break it into one next action.',
      neutral: 'Tell me the main problem around money or work, then we can think through the next practical step.'
    },
    health: {
      stressed: 'When your body is tired, emotions get harder to manage too. Have you eaten, slept, or rested enough today?',
      anxious: 'Health worries can make the mind jump to worst-case thoughts. What symptom or situation is worrying you most?',
      sad: 'Feeling unwell can make everything emotionally heavier. What would make your body feel even a little safer right now?',
      neutral: 'Tell me what is happening with your body or sleep, and we can think through a gentle next step.'
    }
  };
  const topicSet = topicReplies[topic];
  if (topicSet) return topicSet[analysis.mood] || topicSet.neutral;

  if (intent.asksAdvice) {
    if (analysis.mood === 'stressed') return 'For this stress, start small: pause for one slow breath, write the problem in one sentence, then choose only the next step. What is the one thing you can do in the next 10 minutes?';
    if (analysis.mood === 'anxious') return 'When anxiety is loud, do not argue with every thought. Try this: name what you know for sure, name what you are guessing, then choose one grounding action. What thought is repeating most?';
    if (analysis.mood === 'sad') return 'When you feel low, the goal is not to fix everything at once. Start with care: drink water, sit somewhere safe, message someone kind, or tell me what triggered the sadness.';
    if (analysis.mood === 'angry') return 'Before you respond to anyone, give your body a moment to cool down. What boundary or need is underneath the anger?';
    return 'Let us make this practical. Tell me the situation, what you feel, and what outcome you want. Then I will help you choose a next step.';
  }

  if (analysis.mood === 'stressed') return pick([
    'That sounds like a lot to carry.'+continuity+' What is the biggest thing pressing on you right now?',
    'I can sense pressure in your message. Let us make the moment smaller: what is one thing you can pause, postpone, or ask help with?',
    'Stress can make everything feel urgent at once. What is the first problem we should untangle?'
  ]);
  if (analysis.mood === 'anxious') return pick([
    'I hear the worry in that. What thought keeps repeating in your mind?',
    'Anxiety can make danger feel closer than it is. What is happening right now, and what are you afraid might happen next?',
    'Let us slow this down together. Look around and name one thing that tells you you are safe in this moment.'
  ]);
  if (analysis.mood === 'sad') return pick([
    'I am sorry you are feeling this low. You do not have to explain perfectly. What triggered it today?',
    'That sounds painful. I am here with you. What would make this moment even slightly easier?',
    'Feeling drained like this can be heavy. Do you want comfort first, or do you want help figuring out what to do next?'
  ]);
  if (analysis.mood === 'angry') return pick([
    'It makes sense that you feel upset if something crossed a line. What happened right before the anger came up?',
    'Anger often protects something important. Did you feel ignored, disrespected, blamed, or treated unfairly?',
    'Before reacting, let us understand it. What do you wish the other person understood?'
  ]);
  if (analysis.sentiment === 'positive') return pick([
    'I am glad to hear that. What helped you feel this way today?',
    'That sounds like a good shift. Let us notice what worked so you can come back to it later.',
    'I like hearing that progress. What do you want to do with that energy today?'
  ]);

  if (intent.wantsComfort) return 'I am here with you. You can take your time. Tell me the part that feels hardest to say.';
  return pick([
    'I am listening. Tell me more about what happened and how it made you feel.',
    'Thank you for sharing that. What feeling would you use to describe this moment?',
    'We can explore this gently. What part of it is affecting you the most?',
    'I hear you. Do you want advice, comfort, or just space to talk?'
  ]);
}
function extractOpenAIText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts = data?.output?.flatMap(item => item.content || []) || [];
  const text = parts.map(part => part.text || '').join('\n').trim();
  return text || null;
}
async function generateGptReply(message, analysis, history = []) {
  if (!HAS_OPENAI_KEY) return null;
  const recentHistory = (history || []).slice(-6).flatMap(item => ([
    { role: 'user', text: item.userMessage },
    { role: 'assistant', text: item.botReply }
  ])).filter(item => item.text);
  const context = recentHistory.map(item => `${item.role}: ${item.text}`).join('\n');
  const prompt = [
    'You are MindCare AI, a warm mental wellness support chatbot for a final-year student project.',
    'Respond directly to the patient based on their exact message, emotional tone, and recent context.',
    'The patient may write in English, Kiswahili, Sheng, or a mix. Understand phrases like "nimechoka", "niko na stress", "nina wasiwasi", "nimejam", "sina hope", "iko noma", and reply in the same language mix when natural.',
    'Use simple, caring language. Sound human, not robotic. Keep replies to 2-5 short sentences.',
    'Do not diagnose, prescribe medicine, claim to be a real therapist, or replace professional care.',
    'If the patient asks for advice, give one practical next step and one gentle follow-up question.',
    'If the patient is sad, anxious, stressed, or angry, validate the feeling before suggesting anything.',
    'If there is self-harm, suicide, or immediate danger, encourage urgent real-person help and local emergency support.',
    `Detected mood: ${analysis.mood}. Sentiment: ${analysis.sentiment}. Risk: ${analysis.risk}. Confidence: ${analysis.confidence}%.`,
    context ? `Recent conversation:\n${context}` : 'No previous conversation context yet.'
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: prompt }] },
        { role: 'user', content: [{ type: 'input_text', text: message }] }
      ],
      max_output_tokens: 220
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('OpenAI response failed:', response.status, detail.slice(0, 300));
    return null;
  }
  const data = await response.json();
  return extractOpenAIText(data);
}

app.get('/api/health', (req,res)=>res.json({ ok:true, name:'MindCare AI API', firebaseAuth: !!firebaseEnabled() }));
app.post('/api/auth/register', async (req,res)=>{
  const { name, email, password, role='user' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error:'Name, email and password are required' });
  if (db.users.find(u=>u.email===email)) return res.status(409).json({ error:'Email already exists' });
  let firebaseUser = null;
  try {
    if (firebaseEnabled()) firebaseUser = await firebaseAuth('register', email, password);
  } catch (e) {
    return res.status(e.status || 401).json({ error:e.message });
  }
  const user = { id: firebaseUser?.localId || uuid(), firebaseId: firebaseUser?.localId || null, firebaseToken: firebaseUser?.idToken || null, publicChatId: publicChatId(), name, email, passwordHash: await bcrypt.hash(password, 10), role };
  db.users.push(user); db.chats[user.id] = []; db.settings[user.id] = { theme:'light', language:'English', notifications:true, consentText:true, consentVoice:true, consentMedia:true, emergencyContact:'', preferredTherapist:'' };
  res.json({ token: tokenFor(user), user: publicUser(user) });
});
app.post('/api/auth/login', async (req,res)=>{
  const { email, password } = req.body;
  let user = db.users.find(u=>u.email===email);
  if (firebaseEnabled()) {
    try {
      const firebaseUser = await firebaseAuth('login', email, password);
      if (!user) {
        user = { id: firebaseUser.localId, firebaseId: firebaseUser.localId, firebaseToken: firebaseUser.idToken, publicChatId: publicChatId(), name: email.split('@')[0], email, passwordHash: await bcrypt.hash(password, 10), role:'user' };
        db.users.push(user); db.chats[user.id] = []; db.settings[user.id] = { theme:'light', language:'English', notifications:true, consentText:true, consentVoice:true, consentMedia:true, emergencyContact:'', preferredTherapist:'' };
      } else {
        user.firebaseId = firebaseUser.localId;
        user.firebaseToken = firebaseUser.idToken;
      }
    } catch (e) {
      return res.status(e.status || 401).json({ error:e.message });
    }
  } else if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error:'Invalid email or password' });
  }
  res.json({ token: tokenFor(user), user: publicUser(user) });
});
app.get('/api/me', auth, (req,res)=>{ const u=db.users.find(x=>x.id===req.user.id); res.json({ user:publicUser(u), settings: db.settings[u.id] }); });
app.put('/api/settings', auth, (req,res)=>{ db.settings[req.user.id] = { ...(db.settings[req.user.id]||{}), ...req.body }; res.json(db.settings[req.user.id]); });
app.get('/api/chat/history', auth, (req,res)=> res.json(db.chats[req.user.id] || []));
app.post('/api/chat/message', auth, async (req,res)=>{
  const { message } = req.body;
  if (!message) return res.status(400).json({ error:'Message is required' });
  const analysis = analyzeSentiment(message);
  const history = db.chats[req.user.id] || [];
  let reply = await generateGptReply(message, analysis, history);
  if (!reply) reply = botReply(message, analysis, history);
  const pair = { id:uuid(), userMessage:message, botReply:reply, analysis, createdAt:new Date().toISOString() };
  db.chats[req.user.id] = [...(db.chats[req.user.id]||[]), pair];
  db.moods.push({ id:uuid(), userId:req.user.id, source:'text', mood:analysis.mood, sentiment:analysis.sentiment, risk:analysis.risk, confidence:analysis.confidence, createdAt:pair.createdAt });
  res.json(pair);
});
function directChatKey(a, b, mode) {
  return [a, b].sort().join(':') + ':' + mode;
}
function findUserByChatId(chatId = '') {
  const normalized = String(chatId).trim().toUpperCase();
  return db.users.find(u => ensurePublicChatId(u) === normalized || u.email.toLowerCase() === normalized.toLowerCase());
}
app.get('/api/direct/me', auth, (req,res)=>{
  const user = db.users.find(u => u.id === req.user.id);
  res.json(publicUser(user));
});
app.get('/api/direct/conversation/:mode/:chatId', auth, (req,res)=>{
  const mode = ['friend','therapist'].includes(req.params.mode) ? req.params.mode : 'friend';
  const other = findUserByChatId(req.params.chatId);
  if (!other) return res.status(404).json({ error:'No user found with that MindCare ID or email' });
  if (other.id === req.user.id) return res.status(400).json({ error:'Use another user account to start a direct chat' });
  const key = directChatKey(req.user.id, other.id, mode);
  res.json({ mode, participant: publicUser(other), messages: db.directChats[key] || [] });
});
app.post('/api/direct/message', auth, (req,res)=>{
  const { toChatId, message, mode='friend', attachment=null } = req.body;
  const clean = String(message || '').trim();
  const safeMode = ['friend','therapist'].includes(mode) ? mode : 'friend';
  if (!toChatId || (!clean && !attachment)) return res.status(400).json({ error:'Recipient ID and message or attachment are required' });
  const from = db.users.find(u => u.id === req.user.id);
  const to = findUserByChatId(toChatId);
  if (!to) return res.status(404).json({ error:'No user found with that MindCare ID or email' });
  if (to.id === from.id) return res.status(400).json({ error:'Use another user account to start a direct chat' });
  const key = directChatKey(from.id, to.id, safeMode);
  const msg = { id:uuid(), mode:safeMode, fromId:from.id, fromChatId:ensurePublicChatId(from), fromName:from.name, toId:to.id, toChatId:ensurePublicChatId(to), text:clean, attachment, createdAt:new Date().toISOString() };
  db.directChats[key] = [...(db.directChats[key] || []), msg];
  res.json({ sent:true, message:msg, conversation:db.directChats[key], participant:publicUser(to) });
});
app.post('/api/calls/signal', auth, (req,res)=>{
  const { toChatId, type, payload={}, callType='voice' } = req.body;
  const from = db.users.find(u => u.id === req.user.id);
  const to = findUserByChatId(toChatId);
  if (!to) return res.status(404).json({ error:'No user found with that MindCare ID or email' });
  if (to.id === from.id) return res.status(400).json({ error:'Use another user account to call' });
  const signal = { id:uuid(), fromId:from.id, fromChatId:ensurePublicChatId(from), fromName:from.name, toId:to.id, toChatId:ensurePublicChatId(to), type, callType, payload, createdAt:new Date().toISOString() };
  db.callSignals[to.id] = [...(db.callSignals[to.id] || []), signal].slice(-80);
  res.json({ sent:true, signal });
});
app.get('/api/calls/signals', auth, (req,res)=>{
  const signals = db.callSignals[req.user.id] || [];
  db.callSignals[req.user.id] = [];
  res.json(signals);
});
app.post('/api/analyze/voice', auth, upload.single('audio'), (req,res)=>{
  const names = ['neutral','stressed','anxious','calm']; const mood = req.file?.size > 800000 ? 'stressed' : names[Math.floor(Math.random()*names.length)];
  const result = { source:'voice', mood, sentiment: mood==='calm'?'positive': mood==='neutral'?'neutral':'negative', risk: mood==='stressed'?'medium':'low', confidence: 72 + Math.floor(Math.random()*18) };
  db.moods.push({ id:uuid(), userId:req.user.id, ...result, createdAt:new Date().toISOString() }); res.json(result);
});
app.post('/api/analyze/media', auth, upload.single('media'), (req,res)=>{
  const mood = req.file?.mimetype?.includes('video') ? 'fatigue' : 'neutral'; const result = { source:'image_video', mood, sentiment:mood==='neutral'?'neutral':'negative', risk:mood==='neutral'?'low':'medium', confidence:76 };
  db.moods.push({ id:uuid(), userId:req.user.id, ...result, createdAt:new Date().toISOString() }); res.json(result);
});
app.get('/api/fusion/latest', auth, (req,res)=>{
  const recent = db.moods.filter(m=>m.userId===req.user.id).slice(-5); const riskOrder={low:1,medium:2,high:3,critical:4};
  const top = recent.sort((a,b)=>(riskOrder[b.risk]||1)-(riskOrder[a.risk]||1))[0] || { mood:'neutral', risk:'low', confidence:60 };
  res.json({ finalMood: top.mood, finalRisk: top.risk, confidence: top.confidence, inputs: recent });
});
app.get('/api/dashboard', auth, (req,res)=>{
  const moods = db.moods.filter(m=>m.userId===req.user.id); const last = moods[moods.length-1] || null;
  res.json({ currentMood:last?.mood||'neutral', risk:last?.risk||'low', moodHistory:moods.slice(-10), chats:(db.chats[req.user.id]||[]).slice(-5), appointments:db.appointments.filter(a=>a.userId===req.user.id) });
});
app.get('/api/therapists', auth, (req,res)=>res.json(therapists));
app.post('/api/therapists', auth, (req,res)=>{ const t={ id:uuid(), rating:4.5, ...req.body }; therapists.push(t); res.json(t); });
app.put('/api/therapists/:id', auth, (req,res)=>{ const i=therapists.findIndex(t=>t.id===req.params.id); if(i<0) return res.status(404).json({error:'Therapist not found'}); therapists[i]={...therapists[i],...req.body,id:req.params.id}; res.json(therapists[i]); });
app.delete('/api/therapists/:id', auth, (req,res)=>{ const i=therapists.findIndex(t=>t.id===req.params.id); if(i<0) return res.status(404).json({error:'Therapist not found'}); const removed=therapists.splice(i,1)[0]; res.json(removed); });
app.post('/api/appointments', auth, (req,res)=>{ const appt={ id:uuid(), userId:req.user.id, status:'pending', ...req.body, createdAt:new Date().toISOString() }; db.appointments.push(appt); res.json(appt); });
app.post('/api/alerts', auth, (req,res)=>{ const alert={ id:uuid(), userId:req.user.id, ...req.body, createdAt:new Date().toISOString() }; db.alerts.push(alert); res.json({ sent:true, alert }); });
app.post('/api/journal', auth, (req,res)=>{ const j={ id:uuid(), userId:req.user.id, text:req.body.text, createdAt:new Date().toISOString() }; db.journals.push(j); res.json(j); });
if (!IS_VERCEL) {
  app.use(express.static(frontendDist));
  app.get('*', (req,res)=>res.sendFile(path.join(frontendDist, 'index.html')));
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

export default app;
