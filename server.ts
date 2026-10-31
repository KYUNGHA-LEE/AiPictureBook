import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Modality, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

try {
  // @ts-ignore
  if (typeof process.loadEnvFile === 'function') {
    // @ts-ignore
    process.loadEnvFile('.env.local');
  }
} catch {
  try {
    // @ts-ignore
    if (typeof process.loadEnvFile === 'function') {
      // @ts-ignore
      process.loadEnvFile('.env');
    }
  } catch {}
}

// Server-side Google GenAI initialization
function getAI(req?: express.Request): GoogleGenAI {
  const customKey = (req?.headers?.['x-gemini-api-key'] as string)?.trim() || (req?.body?.apiKey as string)?.trim();
  const apiKey = customKey || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  return new GoogleGenAI(apiKey ? { apiKey } : {});
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasServerKey: !!(process.env.GEMINI_API_KEY || process.env.API_KEY)
  });
});

app.get('/api/key-status', (req, res) => {
  const customKey = (req.headers?.['x-gemini-api-key'] as string)?.trim();
  const activeKey = customKey || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  const isPlaceholder = !activeKey || activeKey.includes('Free Tier') || activeKey.startsWith('AQ.');
  const masked = activeKey && !isPlaceholder ? `${activeKey.slice(0, 6)}...${activeKey.slice(-4)}` : null;
  res.json({
    hasKey: !!activeKey && !isPlaceholder,
    maskedKey: masked,
    isPlaceholder
  });
});

app.post('/api/save-key', async (req, res) => {
  try {
    const rawKey = (req.body?.apiKey || '').trim();
    if (!rawKey) {
      return res.status(400).json({ ok: false, error: 'API 키를 입력해 주세요.' });
    }
    // Verify the key with a fast call to Google GenAI
    const testAi = new GoogleGenAI({ apiKey: rawKey });
    const result = await testAi.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'hi',
      config: { maxOutputTokens: 3 }
    });
    if (result && result.text !== undefined) {
      process.env.GEMINI_API_KEY = rawKey;
      try {
        fs.writeFileSync(path.resolve(__dirname, '.env.local'), `GEMINI_API_KEY=${rawKey}\n`, 'utf-8');
      } catch (err) {
        console.warn('Failed to write .env.local:', err);
      }
      return res.json({
        ok: true,
        message: 'Gemini API 키가 성공적으로 등록 및 검증되었습니다!',
        maskedKey: `${rawKey.slice(0, 6)}...${rawKey.slice(-4)}`
      });
    }
    res.json({ ok: true, message: 'API 키가 등록되었습니다.' });
  } catch (err: any) {
    let msg = err?.message || 'API 키 검증 실패';
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.error?.message) {
        msg = parsed.error.message;
      }
    } catch {}
    res.status(400).json({ ok: false, error: msg });
  }
});

app.post('/api/delete-key', (req, res) => {
  process.env.GEMINI_API_KEY = '';
  try {
    const envFile = path.resolve(__dirname, '.env.local');
    if (fs.existsSync(envFile)) {
      fs.unlinkSync(envFile);
    }
  } catch {}
  res.json({ ok: true, message: '등록된 API 키가 삭제되었습니다.' });
});

app.all('/api/test-key', async (req, res) => {
  try {
    const customKey = (req.headers?.['x-gemini-api-key'] as string)?.trim() || (req.body?.apiKey as string)?.trim() || (req.query?.apiKey as string)?.trim();
    const key = customKey || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    if (!key) {
      return res.status(400).json({ ok: false, error: '등록된 API 키가 없습니다. API 키를 입력해 주세요.' });
    }
    const ai = new GoogleGenAI({ apiKey: key });
    const result = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'hi',
      config: { maxOutputTokens: 3 }
    });
    if (result && result.text !== undefined) {
      return res.json({ ok: true, message: 'Gemini API가 성공적으로 연결되었습니다!' });
    }
    res.json({ ok: true, message: 'Gemini API 연결 확인 완료' });
  } catch (err: any) {
    let msg = err?.message || 'API 키 검증 실패';
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.error?.message) {
        msg = parsed.error.message;
      }
    } catch {}
    res.status(400).json({ ok: false, error: msg });
  }
});

app.all('/api/list-models', async (req, res) => {
  try {
    const ai = getAI(req);
    const pager = await ai.models.list();
    const list: any[] = [];
    for await (const m of pager) {
      list.push({ name: m.name, displayName: m.displayName, supportedGenerationMethods: m.supportedGenerationMethods });
    }
    res.json({ ok: true, count: list.length, models: list });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: errText(err) });
  }
});

const MODELS = {
  text: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
  image: {
    fast: ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image'],
    standard: ['gemini-3.1-flash-image', 'gemini-nano-banana-2.1', 'gemini-3-pro-image'],
    pro: ['gemini-nano-banana-2.1', 'gemini-3-pro-image', 'gemini-3.1-flash-image']
  } as Record<string, string[]>,
  tts: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']
};

function errText(e: any): string {
  return String(e?.message || e || '');
}

const isNotFound = (e: any) => (e?.status ?? e?.code) === 404 || /NOT_FOUND|not found|is not supported/i.test(errText(e));

async function tryModels<T>(models: string[], run: (model: string) => Promise<T>): Promise<T> {
  let last: any;
  for (const m of models) {
    try {
      return await run(m);
    } catch (e) {
      last = e;
      if (!isNotFound(e)) throw e;
    }
  }
  throw last;
}

function inline(dataUrl: string) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  return { inlineData: { mimeType: m ? m[1] : 'image/png', data: m ? m[2] : dataUrl.split(',')[1] } };
}

function extractImage(res: any): string {
  const parts = res?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    if (p.inlineData?.data) {
      return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
    }
  }
  const reason = res?.promptFeedback?.blockReason || res?.candidates?.[0]?.finishReason;
  const said = parts.map((p: any) => p.text).filter(Boolean).join(' ').slice(0, 120);
  throw new Error(reason && reason !== 'STOP' ? `SAFETY ${reason}` : said || 'AI가 그림을 돌려주지 않았어요.');
}

async function callImage(
  aiClient: GoogleGenAI,
  models: string[],
  parts: any[],
  aspect: string,
  size: '1K' | '2K' = '1K'
): Promise<string> {
  return tryModels(models, async model => {
    const run = (imageConfig?: Record<string, string>) =>
      aiClient.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: imageConfig ? { imageConfig } : undefined
      });
    let res;
    try {
      res = await run({ aspectRatio: aspect, imageSize: size });
    } catch (e: any) {
      if ((e?.status ?? e?.code) === 400 && /image_?size|imageConfig|aspect/i.test(errText(e))) {
        res = await run({ aspectRatio: aspect });
      } else {
        throw e;
      }
    }
    return extractImage(res);
  });
}

async function callText(aiClient: GoogleGenAI, prompt: string, jsonSchema?: object): Promise<string> {
  return tryModels(MODELS.text, async model => {
    const res = await aiClient.models.generateContent({
      model,
      contents: prompt,
      config: jsonSchema ? { responseMimeType: 'application/json', responseSchema: jsonSchema as any } : undefined
    });
    const text = res.text;
    if (!text) throw new Error('AI가 응답을 반환하지 않았어요.');
    return text;
  });
}

export interface StyleDefinition {
  desc: string;
  directive: string;
  samplePrompt: string;
}

export const STYLE_DEFINITIONS: Record<string, StyleDefinition> = {
  "수채화 풍의 따뜻한 스타일": {
    desc: "물감의 자연스러운 번짐과 맑은 투명감이 살아있는 따뜻한 수채화",
    directive: "Masterpiece watercolor children's book illustration. Pure wet-on-wet watercolor washes, soft pigment bleeding, natural paper tooth of cold-press rough watercolor paper, gentle organic translucent edges, luminous warm sunlight, soft painterly palette. NOT a 3D render, NOT glossy plastic, NO sharp digital vector lines.",
    samplePrompt: "A cozy watercolor painting of an adorable little woodland creature sitting under a giant blooming sunflower in a sunlit meadow, butterflies fluttering in the warm breeze, soft translucent watercolor bleeding."
  },
  "지브리 애니메이션 스타일": {
    desc: "스튜디오 지브리의 서정적이고 따뜻한 명작 2D 셀 애니메이션 감성",
    directive: "Studio Ghibli classic anime feature film aesthetic, Hayao Miyazaki style. Masterful hand-painted anime background scenery, lush vibrant emerald meadows, billowy painterly cumulus clouds in an azure sky, warm nostalgic atmospheric lighting, classic cel-shaded 2D hand-drawn anime look with expressive soulful eyes, peaceful countryside charm. Traditional Japanese 2D animation art. Absolutely NO 3D/CGI render, NO photorealism.",
    samplePrompt: "A classic Studio Ghibli anime style scene: a charming young adventurer standing on a grassy hill overlooking a magical valley town under billowing summer clouds, a gentle breeze rustling the grass."
  },
  "디즈니 3D 애니메이션 스타일": {
    desc: "디즈니·픽사 극장판 3D 애니메이션의 생생하고 입체적인 고품질 그래픽",
    directive: "High-end Disney Pixar 3D animated feature film CGI style. Stylized 3D character design with expressive large glossy eyes, soft subsurface scattering skin texture, warm volumetric cinematic lighting, richly rendered dimensional environment with depth of field, vibrant colors, polished animation studio render.",
    samplePrompt: "A cinematic Disney Pixar 3D animated character: a sweet curious little woodland animal with big glossy expressive eyes, holding a glowing magical acorn in an enchanted 3D fairytale glade with soft twilight rim lighting."
  },
  "부드러운 파스텔 일러스트": {
    desc: "분필처럼 포근하게 번지는 소프트 파스텔과 몽환적인 감성",
    directive: "Soft chalk pastel storybook illustration. Powdery, velvety chalk pastel textures, softly blended gentle gradients, visible textured paper tooth, dreamy hazy edges, comforting muted warm tones, whimsical and tender atmosphere. NO sharp vector lines, NO 3D render.",
    samplePrompt: "A soft chalk pastel drawing of a sweet sleepy little bear resting on a crescent moon among fluffy marshmallow clouds and gentle glowing stars."
  },
  "귀여운 픽셀 아트 스타일": {
    desc: "레트로 감성의 또렷한 16비트 도트 그래픽 (픽셀 격자가 선명함)",
    directive: "Authentic 16-bit retro pixel art sprite illustration. Crisp visible square pixel grid, charming chiptune indie adventure game aesthetic, handcrafted pixel placement, vibrant limited color palette, isometric or side-view storybook scene. Absolutely NO smooth anti-aliased curves, NO 3D CGI, NO blurry watercolor gradients. Pure authentic nostalgic pixel art.",
    samplePrompt: "An adorable 16-bit retro pixel art scene: a cute pixelated baby bunny knight with a tiny wooden sword standing beside a pixel-art mushroom house in an enchanted 8-bit forest under twinkling pixel stars."
  },
  "색종이 콜라주 스타일": {
    desc: "가위로 정성껏 오려 겹겹이 붙인 입체 색종이와 펠트 콜라주",
    directive: "Layered paper-cut collage art, Eric Carle and Christian Robinson style. Hand-cut textured construction paper, felt sheets, and patterned origami paper layers. Visible scissor-cut edges, distinct paper depth with subtle physical drop shadows between layers, tactile fibrous paper textures, bold charming cutout shapes. NO smooth digital painting, NO 3D plastic.",
    samplePrompt: "A vibrant paper-cut collage illustration: an adorable bird with patterned paper feathers perching on layered textured green paper tree leaves, holding a cut-paper berry, with tactile drop shadows."
  },
  "찰흙/클레이 아트 스타일": {
    desc: "손자국이 정겹게 묻어나는 스톱모션 클레이 점토 인형",
    directive: "Handcrafted stop-motion claymation plasticine art, Aardman and Wallace & Gromit style. Charming sculpted polymer clay figures with tactile surface details, subtle artisanal fingerprint impressions, pliable doughy round shapes, real physical miniature studio lighting, soft clay shadows. Authentic handmade clay model photography look. NO flat 2D lines.",
    samplePrompt: "A delightful claymation stop-motion scene: an adorable little clay-sculpted baby hedgehog wearing a miniature knitted scarf, sitting on a round clay toadstool surrounded by clay pebbles and sculpted moss."
  },
  "연필 소묘 스케치 스타일": {
    desc: "흑연 연필의 섬세한 선과 부드러운 해칭 명암이 돋보이는 소묘",
    directive: "Fine hand-drawn graphite pencil sketch and detailed cross-hatching illustration. Intricate pencil line work, delicate tonal shading, pencil graphite smudging on heavy textured off-white sketch paper, classic monochrome graphite with subtle warm sepia undertone. Vintage storybook draft aesthetic. NO bright saturated colors, NO digital vector lines.",
    samplePrompt: "A detailed graphite pencil sketch of an adorable baby deer resting quietly in a forest hollow under an ancient oak tree, soft pencil crosshatching and dappled graphite sunlight."
  },
  "유화 질감이 느껴지는 스타일": {
    desc: "캔버스 위에 물감을 도톰하게 얹은 묵직한 유화 임파스토 기법",
    directive: "Rich impasto oil painting on coarse linen canvas. Thick painterly brush strokes, visible palette knife texture, dimensional buttery paint ridges reflecting light, deep saturated oil pigment blending, expressive impressionistic classical children's book fine art look. NO flat digital look.",
    samplePrompt: "A lush impressionist oil painting of a warm glowing lantern hanging outside an inviting cottage in twilight woods, rich visible oil paint texture and buttery palette knife strokes."
  },
  "동양화 묵편 스타일": {
    desc: "한지 위에 번지는 깊은 먹선과 여백의 미가 살아있는 전통 수묵화",
    directive: "Traditional East Asian Sumi-e black ink wash brush painting. Expressive black calligraphy brushstrokes, varied ink density from jet black to translucent misty gray, natural ink bleeding on Xuan rice paper, poetic negative space (Ma/Yeobaek), traditional Korean and oriental aesthetic. NO western digital gloss.",
    samplePrompt: "A serene traditional East Asian sumi-e black ink wash painting of a little sparrow resting on a curved bamboo branch in the morning mist, with flowing ink gradients on textured rice paper."
  },
  "사이버펑크 네온 스타일": {
    desc: "어둠 속에서 화려하게 반짝이는 네온사인과 미래적인 네온 불빛",
    directive: "Vibrant cyberpunk neon children's story illustration. Glowing electric cyan, magenta, and neon amber lighting cutting through deep nighttime shadows, futuristic retro synthwave aesthetic, reflective wet pavement reflecting holographic neon signs, stylized high-tech storybook world.",
    samplePrompt: "A charming cyberpunk children's story scene: a friendly little robot cat with glowing LED eyes sitting atop a neon-lit balcony overlooking a glowing futuristic city bathed in purple and teal neon light."
  },
  "미니멀 플랫 디자인": {
    desc: "단순하고 세련된 기하학적 도형과 깔끔한 단색의 모던 플랫",
    directive: "Clean minimalist flat vector design illustration. Bold geometric shapes, clean crisp outlines or borderless solid color planes, sophisticated modern color blocking, Scandinavian graphic design simplicity, high readability and charming minimalist composition. NO complex textures, NO clutter.",
    samplePrompt: "A modern Scandinavian minimalist flat design illustration of a geometric friendly fox sitting beside a minimalist pine tree under a simple golden circle moon against a clean deep navy sky."
  },
  "빈티지 신문 삽화 스타일": {
    desc: "오래된 신문과 고서의 정교한 동판화·목판화 에칭 판화",
    directive: "Vintage 19th-century engraved newspaper illustration and antique woodcut etching. Intricate line engraving, stippling and dense cross-hatching, weathered aged sepia newsprint background with subtle paper creases, authentic Victorian storybook print engraving look.",
    samplePrompt: "An antique vintage newspaper engraving of a curious bespectacled owl wearing a tiny waistcoat, reading an open leather book by candlelight in a cozy hollow tree study."
  },
  "판타지 RPG 게임 스타일": {
    desc: "빛나는 마법 입자와 모험이 가득한 판타지 컨셉 아트",
    directive: "Magical fantasy RPG storybook concept art. Glowing arcane particle motes, luminous fantasy flora, vibrant magical lighting, rich epic fantasy worldbuilding, charming young hero aesthetic, soft atmospheric bloom, captivating adventure atmosphere.",
    samplePrompt: "A magical fantasy adventure storybook illustration of a brave little mouse adventurer with a glowing crystal staff gazing into a hidden glowing fairy cavern filled with luminous blue crystals."
  },
  "정교한 펜 드로잉 스타일": {
    desc: "0.1mm 펜으로 하나하나 그려낸 섬세한 펜화와 맑은 채색",
    directive: "Intricate fine-liner pen and black ink drawing tinted with delicate watercolor wash, Arthur Rackham and Beatrix Potter style. Micro-detailed black ink line work, fine cross-hatching, crisp graceful outlines, subtle soft transparent watercolor coloring, textured parchment paper.",
    samplePrompt: "A delicate pen and ink drawing with soft watercolor tint showing an exquisite miniature mouse house inside an old hollow tree trunk, with tiny shelves, teacups, and a glowing fireplace."
  },
  "팝아트 스타일": {
    desc: "굵은 검은 윤곽선과 벤데이 도트, 원색의 톡톡 튀는 팝아트",
    directive: "Bold retro comic pop art style inspired by Roy Lichtenstein and Andy Warhol. Prominent Ben-Day halftone dot patterns, bold thick black dynamic contour outlines, vibrant punchy primary flat colors (bright yellow, cyan, hot magenta, solid white), comic book pop sensibility, graphic and eye-catching.",
    samplePrompt: "A dynamic pop art illustration of a cheerful happy puppy bursting out of a starburst comic frame with prominent Ben-Day dot shading and bright yellow and red halftone backgrounds."
  },
  "크레파스 낙서 스타일": {
    desc: "아이의 순수한 마음이 담긴 꾸덕꾸덕한 오일 파스텔 크레용 낙서",
    directive: "Expressive child-like wax crayon and heavy oil pastel drawing. Chunky waxy textured crayon strokes, rough uneven coloring with rough paper tooth peeking through, charming naïve innocent child drawing style, rich vibrant wax crayon pigmentation, heartwarming handcrafted warmth.",
    samplePrompt: "A charming childlike wax crayon drawing of a smiling round yellow sun shining brightly over a green crayon hill where a cute fluffy dog with floppy ears is playing with a bright red ball."
  },
  "몽환적인 우주 일러스트": {
    desc: "별가루와 은하수가 신비롭게 펼쳐지는 환상적인 밤하늘",
    directive: "Dreamy cosmic galaxy storybook illustration. Ethereal glowing purple and deep indigo cosmic nebulas, glistening stardust particles, soft glowing celestial moons, floating whimsical planets, enchanting magical night sky ambiance with soft ethereal illumination.",
    samplePrompt: "A dreamy cosmic fairytale illustration: a whimsical little space voyager whale swimming through a sea of sparkling violet stardust and glowing pastel nebulas beneath two smiling crescent moons."
  },
  "숲속 요정 나라 스타일": {
    desc: "이슬 맺힌 버섯과 반딧불이가 가득한 신비로운 요정의 숲",
    directive: "Enchanted fairytale woodland illustration. Glowing bioluminescent mushrooms, tiny floating golden fairy sparkles, soft mossy tree roots, dew-kissed wildflowers, warm magical twilight atmosphere, whimsical storybook folklore wonder.",
    samplePrompt: "An enchanted fairy forest scene with a tiny glowing fairy opening a wooden hollow door in a mossy ancient oak tree, surrounded by glowing bioluminescent turquoise mushrooms and dancing fireflies."
  },
  "귀여운 동물 캐릭터 일러스트": {
    desc: "동글동글한 비율과 사랑스러운 눈망울의 포근한 동물 친구들",
    directive: "Adorable kawaii baby animal storybook illustration. Extremely cute round chubby proportions, big expressive sparkling glossy eyes, soft fluffy fur textures, warm heartwarming expressions, pastel charming nursery color palette, sweet friendly demeanor that children instantly love. Whimsical, cuddly and gentle.",
    samplePrompt: "An utterly adorable chubby baby bunny and a tiny fluffy duckling wearing miniature knitted overalls, sharing a warm cup of cocoa under a cozy toadstool umbrella in a gentle warm rain."
  },
  "종이 인형극 스타일": {
    desc: "핀으로 관절을 연결해 무대 위에서 움직이는 그림자 종이 인형극",
    directive: "Articulated paper marionette shadowbox puppet theater. Cutout paper characters with visible brass joint eyelet pins, layered wooden puppet theater proscenium stage, theatrical footlight illumination, vintage shadow puppet and paper toy theater charm.",
    samplePrompt: "A magical miniature paper puppet theater scene: an articulated paper prince puppet and a paper dragon puppet on a layered shadowbox stage with soft warm footlights casting gentle shadows."
  },
  "수묵 담채화 스타일": {
    desc: "은은한 먹빛과 맑은 물빛이 시처럼 어우러지는 전통 수묵담채",
    directive: "Traditional Korean Sumok-damchewha (water-and-ink wash with subtle color tints). Elegant fluid black sumi ink lines combined with soft, translucent light watercolor washes, ample atmospheric negative space, delicate poetry of traditional Korean mulberry Hanji paper.",
    samplePrompt: "A poetic Korean traditional ink and light wash (Sumok-damchewha) painting of two magpies perched on a persimmon tree branch with bright orange persimmons in late autumn, soft misty background."
  },
  "코믹스 만화 스타일": {
    desc: "생동감 넘치는 펜선과 만화책 특유의 유쾌한 컷 연출",
    directive: "Vibrant graphic novel comic book style for kids. Dynamic expressive inked character action, energetic line weights, clean comic book cel coloring, lively expressive facial reactions, classic storybook comic adventure vibe.",
    samplePrompt: "A lively comic book style illustration of an adventurous boy and his funny robot sidekick leaping excitedly over a puddle on a sunny street, comic speed lines and cheerful bright colors."
  },
  "샌드아트 스타일": {
    desc: "빛나는 라이트박스 위 모래 알갱이의 실루엣으로 빚어낸 샌드아트",
    directive: "Illuminated sand animation art on a warm glowing lightbox. Masterful sand silhouettes created with fine grain sand swept by artist fingertips, luminous backlit golden glow, expressive gradient transparency of sand dust, dramatic monochromatic sand artistry.",
    samplePrompt: "An exquisite sand art performance piece on a glowing warm lightbox: delicate sand silhouettes of a mother bird feeding its baby chicks in a nest, surrounded by soft swept sand grain textures and golden light."
  },
  "레고 브릭 아트 스타일": {
    desc: "블록 하나하나를 조립해 만든 귀여운 레고 브릭 세상",
    directive: "Built entirely out of colorful plastic interlocking Lego toy bricks. Authentic plastic brick textures with visible round studs on top, shiny glossy plastic surfaces, miniature tilt-shift toy photography lighting, adorable Lego minifigure proportions.",
    samplePrompt: "A delightful scene built completely out of colorful Lego plastic toy bricks: a cute yellow Lego minifigure standing in front of a red Lego house with a green Lego tree and bright blue Lego sky."
  },
  "고전 명화 패러디 스타일": {
    desc: "르네상스·바로크 명화의 웅장한 빛과 유화 붓터치 패러디",
    directive: "Classical Renaissance and Baroque museum masterpiece parody. Dramatic chiaroscuro theatrical lighting (Rembrandt & Vermeer style), rich dark oil glazing, cracked vintage canvas patina, regal ornate composition applied to whimsical storybook characters.",
    samplePrompt: "A humorous classical Baroque oil painting parody: a dignified fluffy cat in an elaborate 17th-century lace ruff collar, posed like a royal portrait with dramatic golden chiaroscuro lighting and antique cracked oil canvas texture."
  },
  "화려한 스테인드글라스 스타일": {
    desc: "햇살이 투과하는 보석처럼 영롱한 성당의 오색 유리창",
    directive: "Magnificent stained glass window art. Intricate black lead came outlines separating vibrant translucent jewel-toned colored glass panes (ruby red, cobalt blue, emerald green, amber yellow), radiant sunlight streaming through glowing kaleidoscopic glass.",
    samplePrompt: "A breathtaking stained glass window illustration: an enchanting storybook castle and flying pegasus rendered in luminous stained glass mosaic with thick black lead joints and glowing colorful sunlight."
  },
  "자수 및 퀼트 천 스타일": {
    desc: "한 땀 한 땀 색실로 정성껏 수놓은 자수와 포근한 패치워크 천",
    directive: "Detailed textile embroidery and quilted patchwork fabric art. Visible colorful cotton thread embroidery stitches, satin stitches, french knots, textured woven cotton fabrics, felt appliqué layers, cozy tactile handcrafted needlework charm.",
    samplePrompt: "A cozy handcrafted embroidery and patchwork quilt piece: an adorable baby bear sewn with brown tweed fabric, with detailed embroidered thread facial features and stitched yellow honey pot on floral patterned quilt fabric."
  },
  "신비로운 고딕 동화 스타일": {
    desc: "팀 버튼 느낌의 기묘하고 신비로운 흑백 잉크 판타지",
    directive: "Mysterious gothic fairytale illustration, Tim Burton and Edward Gorey aesthetic. Whimsical spooky storybook atmosphere, spindly curling tree branches, striped patterns, delicate gothic ink cross-hatching, hauntingly beautiful dark fairytale charm with a hint of warm glow.",
    samplePrompt: "A whimsical gothic fairytale scene: a sweet eccentric little character with a tall striped hat and glowing lantern walking through a misty forest of twisting curly trees under a giant pale moon."
  },
  "크리스마스 동화 스타일": {
    desc: "하얀 눈과 따뜻한 벽난로, 반짝이는 전구의 성탄절 동화",
    directive: "Cozy warm Christmas holiday storybook illustration. Fluffy falling snow outside frost-patterned window panes, glowing golden fairy lights, pine garland with red ribbon bows, cozy crackling stone fireplace, rich festive evergreen and crimson color palette, heartwarming holiday magic.",
    samplePrompt: "A heartwarming Christmas fairytale scene: a sweet little bunny peeking out from behind a beautifully decorated evergreen Christmas tree lit with warm glowing fairy lights, as snow gently falls outside the window."
  }
};

function styleGuard(style: string): string {
  const def = STYLE_DEFINITIONS[style];
  if (def) {
    return `MANDATORY ART STYLE DIRECTIVE for "${style}":\n${def.directive}`;
  }
  const three = /3D|클레이|찰흙|레고|입체|디오라마/i.test(style);
  return three
    ? `Render EVERYTHING (characters, background, furniture, props) in the same "${style}" look, with the same materials, lighting and level of detail.`
    : `Render EVERYTHING in ONE consistent hand-made illustration look: "${style}". Match textures, brushwork, materials, and line art consistently across all elements.`;
}

// ---------------- API ENDPOINTS ---------------- //

// 1. 이야기 자동 기획 / 원고 삽입
app.post('/api/plan-story', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { topic, age, pageCount, style, existingCharacters, existingLocations } = req.body;
    const schema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        characters: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { name: { type: Type.STRING }, description: { type: Type.STRING } },
            required: ['name', 'description']
          }
        },
        locations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { name: { type: Type.STRING }, description: { type: Type.STRING } },
            required: ['name', 'description']
          }
        },
        pages: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              content: { type: Type.STRING },
              sceneIdea: { type: Type.STRING },
              characters: { type: Type.ARRAY, items: { type: Type.STRING } },
              location: { type: Type.STRING }
            },
            required: ['content', 'sceneIdea', 'characters', 'location']
          }
        }
      },
      required: ['title', 'characters', 'locations', 'pages']
    };

    const knownChars = (existingCharacters || []).filter((c: any) => c.name?.trim());
    const knownLocs = (existingLocations || []).filter((l: any) => l.name?.trim());

    const prompt = `당신은 어린이 동화 작가입니다. 아래 조건으로 동화책 한 권의 초안을 만들어 주세요.

- 주제/아이디어: ${topic}
- 독자 연령: ${age}
- 정확히 ${pageCount}쪽 (pages 배열의 길이는 반드시 ${pageCount})
- 그림 스타일: ${style}
${knownChars.length ? `- [중요] 이미 등록된 주인공/등장인물이 있습니다. 이 인물들을 반드시 주인공으로 등장시켜 이야기를 전개하세요:\n${knownChars.map((c: any) => `  * ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n')}` : ''}
${knownLocs.length ? `- [중요] 이미 등록된 주요 장소가 있습니다. 이야기 전개 시 이 장소들을 배경으로 활용하세요:\n${knownLocs.map((l: any) => `  * ${l.name}${l.description ? `: ${l.description}` : ''}`).join('\n')}` : ''}
- 기승전결이 있고, 따뜻하고 교훈이 자연스럽게 담기게.
- content: 그 쪽에 들어갈 동화 본문(한국어, 연령에 맞는 어휘, 1~3문장). 작가가 나중에 수정하기 좋도록 자연스러운 동화 문장으로 작성.
- sceneIdea: 그 쪽 삽화 설명. [핵심] 등장인물의 행동/표정과 더불어, **그 인물에 특화된 고유한 배경(일터/공간의 특징적인 소품, 장비, 차량, 건물 구조, 조명, 주변 환경)**을 구체적으로 서술할 것.
- characters(전체): 주요 등장인물 및 조연 1~6명.
- pages[].characters: 그 쪽에 등장하는 인물의 name 목록(전체 characters의 name과 정확히 일치).
- locations(전체): 이야기에 나오는 장소 목록 (필요한 만큼 최대 15곳까지 자유롭게 분리 등록).
  * [필수 한국적 고증 & 배경 차별화 규칙]:
    - [매우 중요: 한국 경비원 고증]: 한국에는 단독주택가 경비원이 전혀 없습니다! 경비원이 나오는 장면은 반드시 '아파트 단지 경비실' (뒤편에 고층 아파트 건물들이 우뚝 솟아 있는 대단지 아파트 정문 경비초소, 차량 출입 차단봉, 노란 불빛이 켜진 아늑한 유리창 경비실, 손전등과 책상)로 설정하세요. 절대로 단독주택 골목길로 설정하지 마세요!
    - 예시: 소방관 등장 장면 -> '소방서 차고지' (출동 대기 중인 붉은 대형 소방차와 차고, 소방 호스와 안전모)
    - 예시: 택배 기사 등장 장면 -> '택배 트럭 앞 골목' (택배 상자가 가득 실린 파란색 택배 탑차, 손수레, 가로등)
    - 예시: 부엉이 혼자 있는 장면 -> '밤하늘 숲속 둥지' (큰 참나무 가지 둥지, 밤하늘과 달빛)
    - 예시: 기타 인물 -> '24시 편의점', '심야 베이커리/빵집', '지구대 파출소', '새벽 도로 청소' 등 다양한 밤의 일터
  * 절대로 모든 인물이 똑같은 단일 배경(예: 그냥 동네 골목)에 머물지 않도록 인물에 맞춰 배경을 다채롭게 배분하세요.
- pages[].location: 그 쪽의 장소 name(전체 locations의 name과 정확히 일치). 그 장면에 나오는 인물의 일터/환경에 맞는 장소를 정확히 연결하고, sceneIdea에도 그 장소의 특색 있는 소품과 배경을 반영할 것.`;

    const raw = await callText(aiClient, prompt, schema);
    const story = JSON.parse(raw);
    res.json(story);
  } catch (error: any) {
    console.error('plan-story error:', error);
    res.status(500).json({ error: errText(error) });
  }
});

// 2. 본문(스크립트) 분석
app.post('/api/analyze-script', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { pages, style, knownCharacters, knownLocations } = req.body;
    const strArr = { type: Type.ARRAY, items: { type: Type.STRING } };
    const named = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, description: { type: Type.STRING } },
        required: ['name', 'description']
      }
    };
    const schema = {
      type: Type.OBJECT,
      properties: {
        characters: named,
        locations: named,
        pages: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { characters: strArr, location: { type: Type.STRING } },
            required: ['characters', 'location']
          }
        }
      },
      required: ['characters', 'locations', 'pages']
    };

    const script = pages
      .map((p: any, i: number) => `[${i + 1}쪽]\n본문: ${p.content?.trim() || '(비어 있음)'}${p.sceneIdea?.trim() ? `\n그림 설명: ${p.sceneIdea.trim()}` : ''}`)
      .join('\n\n');

    const prompt = `당신은 그림책 스토리보드 감독입니다. 아래 동화 스크립트를 읽고, 삽화를 일관되면서도 장면에 맞게 다채롭게 그리기 위한 '캐릭터'와 '장소' 목록을 만들어 주세요.

그림 스타일: ${style}
${knownCharacters?.length ? `이미 등록된 캐릭터: ${knownCharacters.join(', ')}` : ''}
${knownLocations?.length ? `이미 등록된 장소: ${knownLocations.join(', ')}` : ''}

[스크립트]
${script}

규칙:
- characters: 이야기에 나오는 중요한 인물·동물·마스코트(최대 6). name은 본문에 나온 이름 그대로. description은 외모를 구체적으로.
- locations: [핵심] 등장인물에 따라 배경이 다르게 나타나도록, 각 인물의 활동 장소나 일터(예: 경비원은 한국 고증상 단독주택가가 아닌 '아파트 단지 경비실'(고층 아파트 단지 정문 경비초소, 차량 차단기, 아늑한 불빛), 소방관은 '소방서 차고지', 택배 기사는 '택배 트럭 앞 골목' 등)를 개별 location으로 등록하세요 (필요한 만큼 최대 15곳까지).
  * 절대로 모든 인물을 '동네'나 '거리' 같은 1개의 장소로 뭉뚱그리지 말고, 각 인물의 환경에 맞는 고유한 장소(고정 구조, 주요 소품, 조명)를 명확히 구분하세요.
- pages: 정확히 ${pages.length}개(쪽 순서대로). 각 쪽에 실제로 등장하는 characters의 name 목록과 해당 인물의 활동에 맞는 구체적인 location의 name.`;

    const raw = await callText(aiClient, prompt, schema);
    const result = JSON.parse(raw);
    res.json(result);
  } catch (error: any) {
    console.error('analyze-script error:', error);
    res.status(500).json({ error: errText(error) });
  }
});

// 3. 장면 설명 다듬기
app.post('/api/enhance-scene', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { scene, content, style, characters, location } = req.body;
    const chars = (characters || [])
      .filter((c: any) => c.name && c.description)
      .map((c: any) => `- ${c.name}: ${c.description}`)
      .join('\n');
    const prompt = `어린이 그림책의 한 장면을 그림 AI에게 설명하려고 합니다. 아래 정보를 바탕으로, 그림 AI가 정확히 그릴 수 있게 구체적인 장면 설명으로 다시 써 주세요.

그림 스타일: ${style}
그 쪽의 동화 본문: ${content || '(없음)'}
사용자가 적은 장면 설명: ${scene || '(없음 - 본문을 보고 장면을 상상해서 작성)'}
${chars ? `등장인물 외모(변경 금지):\n${chars}` : ''}
${location ? `장소 설정(변경 금지): ${location.name}${location.description ? ` - ${location.description}` : ''}` : ''}

규칙:
- [한국 문화적 고증 필수 - 경비원]: 한국에는 단독주택가 경비원이 전혀 없습니다. '경비원'이 등장할 때는 반드시 **한국 대단지 아파트 정문 경비초소(뒤편에 고층 아파트 건물들이 우뚝 솟아 있고, 단지 출입 차량 차단기, 노란 불빛의 아늑한 유리창 경비실, 손전등과 책상, 단지 가로등)**로 묘사하세요. 절대로 일반 단독주택가나 단독주택 골목으로 묘사하지 마세요.
- [인물별 맞춤 배경 특화]: 소방관은 소방서 차고와 빨간 소방차, 택배 기사는 택배 탑차와 상자 더미, 부엉이는 깊은 밤 참나무 둥지 등 각 인물의 고유한 일터를 구체적으로 묘사하세요. 다른 인물이 나오는 장면과 배경이 똑같아 보이지 않도록 하세요.
- 구도, 등장인물의 행동과 표정, 배경, 조명, 색감, 분위기를 포함.
- 원래 사용자가 적은 내용과 이름은 바꾸거나 빼지 말 것.
- 3~5문장, 한국어. 설명문만 출력(따옴표, 제목, 머리말 금지).
- 그림 안에 글자를 넣으라는 내용은 쓰지 말 것.
- 장소 설정이 있으면 그 구조(가구·창문·문의 위치)를 바꾸지 말고 그대로 사용할 것.`;

    const enhanced = (await callText(aiClient, prompt)).trim();
    res.json({ text: enhanced });
  } catch (error: any) {
    console.error('enhance-scene error:', error);
    res.status(500).json({ error: errText(error) });
  }
});

// 4. 캐릭터 시트 생성
app.post('/api/generate-character-sheet', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { name, description, style, quality, size, reference } = req.body;
    const prompt = `Character reference sheet for a children's picture book.
Art style: ${style}. ${styleGuard(style)}
Character: "${name}" — ${description}.
Show the SAME character in three views on one plain, light background: front view, side view, and a happy 3/4 view. Full body, consistent face, hair, outfit and colors in all views. Simple clean design that is easy to redraw consistently on every page.
No text, no letters, no captions, no labels, no watermark.`;
    const parts: any[] = [{ text: prompt }];
    if (reference) {
      parts.push({ text: 'Reference photo/drawing of this character (keep the look):' }, inline(reference));
    }
    const modelList = MODELS.image[quality] || MODELS.image.standard;
    const imageUrl = await callImage(aiClient, modelList, parts, '1:1', size || '1K');
    res.json({ imageUrl });
  } catch (error: any) {
    console.error('generate-character-sheet error:', error);
    res.status(500).json({ error: errText(error) });
  }
});

// 5. 장소 시트 생성
app.post('/api/generate-location-sheet', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { name, description, style, aspect, quality, size, reference } = req.body;
    const prompt = `Location reference for a children's picture book.
Art style: ${style}. ${styleGuard(style)}
Location: "${name}" — ${description}.
Draw ONE clear, wide establishing view of this place that shows its FIXED layout: exactly where the main furniture, windows, doors and key props are. Eye-level, evenly lit. NO people, NO animals, NO characters.
This image will be reused as the fixed setting on every page, so keep the design simple, clear and easy to redraw consistently.
No text, letters, labels or watermarks.`;
    const parts: any[] = [{ text: prompt }];
    if (reference) {
      parts.push({ text: 'Reference of this place (keep its layout):' }, inline(reference));
    }
    const modelList = MODELS.image[quality] || MODELS.image.standard;
    const imageUrl = await callImage(aiClient, modelList, parts, aspect || '1:1', size || '1K');
    res.json({ imageUrl });
  } catch (error: any) {
    console.error('generate-location-sheet error:', error);
    res.status(500).json({ error: errText(error) });
  }
});

// 6. 페이지 그림 생성
app.post('/api/generate-story-image', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { prompt, style, aspect, quality, size, refs, directing, textInImage, fullPage, settingChanged } = req.body;
    const withLook = (refs?.characters || []).filter((c: any) => c.name);
    const d = directing || {};
    const dirStr = [
      d.shotType && `Shot type: ${d.shotType}`,
      d.verticalAngle && `Vertical angle: ${d.verticalAngle}`,
      d.horizontalAngle && `Horizontal angle: ${d.horizontalAngle}`,
      d.specialPOV && `Special POV: ${d.specialPOV}`
    ].filter(Boolean).join(', ');

    const lines: string[] = [
      "Professional children's picture book illustration.",
      `Art style: ${style}. Keep exactly this style so all pages of the book look like the same book.`,
      styleGuard(style),
      `Scene: ${prompt}`,
      'BACKGROUND UNIQUENESS & CHARACTER TAILORING: The background and environment must be uniquely and vividly matched to the specific character and activity in this scene (e.g. security booth/apartment gate for a security guard; fire station with shiny red fire truck for a firefighter; delivery van with parcels/boxes for a courier; tree branch/night forest for an owl). NEVER repeat an identical background across different characters.',
      'KOREAN CULTURAL ACCURACY FOR SECURITY GUARD (CRITICAL): In Korea, security guards ("경비원") exclusively work at high-rise apartment complexes ("아파트 단지 경비실/경비초소") or commercial office buildings. There are NO security guards in detached residential house streets. When depicting a Korean security guard (경비원), the setting MUST be an authentic Korean apartment complex: a cozy illuminated glass security guard booth (경비실) at the entrance of a high-rise apartment complex, with a vehicle entrance barrier gate arm, glowing interior desk lamp, flashlight, and towering modern Korean apartment buildings in the background with scattered lit windows at night. NEVER draw detached suburban houses, single-family homes, or residential alleys for a security guard.'
    ];
    if (dirStr) lines.push(`Cinematography: ${dirStr}.`);
    if (withLook.length) {
      lines.push(
        `Characters in this scene: ${withLook.map((c: any) => (c.description ? `${c.name} (${c.description})` : c.name)).join('; ')}.`,
        'Every character must look identical to their labelled reference image: same face, hair, outfit, colors and proportions.'
      );
    } else {
      lines.push('No specific named characters; focus on the scene.');
    }
    if (refs?.location) {
      lines.push(
        `Location: "${refs.location.name}"${refs.location.description ? ` (${refs.location.description})` : ''}. The scene MUST take place in exactly this location. Use the labelled location reference and keep the layout identical: the same positions of the bed, windows, doors and furniture, the same wall colors and decorations. Do not move, remove or add fixed furniture; only the camera angle, framing and lighting may change.`
      );
    }
    if (refs?.location && withLook.length) {
      lines.push('Compose the final image by placing the labelled characters naturally INSIDE the labelled location: the characters keep their exact look, and the location keeps its exact layout.');
    }
    if (refs?.background) lines.push('Use the labelled background reference as the same location/environment.');
    if (refs?.styleAnchor) lines.push('Match the art style, color palette and line quality of the labelled style reference (do not copy its content).');
    if (refs?.previous) {
      if (settingChanged) {
        lines.push('The attached previous-page image is provided ONLY for visual consistency of art style and the main protagonist. The setting/background for THIS page is completely new and must strictly depict the new character environment described in Scene. Do NOT reuse or replicate the previous background.');
      } else {
        lines.push('The labelled previous-page image shows the story so far; keep continuity of the setting and characters but draw the NEW scene described above.');
      }
    }
    if (refs?.characters?.some((c: any) => c.imageData) || refs?.location?.imageData || refs?.background || refs?.styleAnchor || refs?.previous) {
      lines.push('IMPORTANT: The attached reference images define only the identity of characters and the layout of places. Do NOT copy their rendering style (for example a 3D or photographic look). Redraw every character and the whole background in the art style above, so they all look painted by the same artist.');
    }
    if (fullPage) {
      lines.push('Composition: this illustration fills the entire page edge to edge (a full-bleed picture-book spread). Compose it as a complete, finished picture with no empty margins.');
    }
    lines.push(
      textInImage?.trim()
        ? `Include this exact Korean text in the image as a natural speech bubble or caption, spelled correctly and clearly legible, with no other text: "${textInImage.trim()}"`
        : 'Do NOT include any text, letters, Hangul, numbers, logos or watermarks. Pure illustration only.',
      'High quality, vibrant colors, detailed characters.'
    );

    const parts: any[] = [{ text: lines.join('\n') }];
    let budget = 14;
    const add = (label: string, url?: string | null) => {
      if (!url || budget <= 0) return;
      parts.push({ text: label }, inline(url));
      budget--;
    };
    withLook.forEach((c: any) => add(`Character reference: ${c.name}`, c.imageData));
    if (refs?.location?.imageData) add(`Location reference: ${refs.location.name}`, refs.location.imageData);
    add('Background reference', refs?.background);
    add('Style reference', refs?.styleAnchor);
    if (refs?.previous) {
      add(settingChanged ? 'Art style reference (new background required)' : 'Previous page', refs.previous);
    }

    const modelList = MODELS.image[quality] || MODELS.image.standard;
    const imageUrl = await callImage(aiClient, modelList, parts, aspect || '1:1', size || '1K');
    res.json({ imageUrl });
  } catch (error: any) {
    console.error('generate-story-image error:', error);
    res.status(500).json({ error: errText(error) });
  }
});

// 7. 표지 생성
app.post('/api/generate-cover', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { title, author, style, aspect, quality, size, characters, sceneHint, withTitle } = req.body;
    const chars = (characters || []).filter((c: any) => c.name);
    const titleLine = withTitle
      ? `Include the book title in Korean as large, beautiful, hand-lettered title text integrated into the artwork: "${title}". Spell every Hangul letter exactly as given. Also include a small line "글·그림 ${author}" near the bottom. No other text.`
      : 'Do NOT include any text, letters or watermarks.';
    const prompt = `Front cover illustration of a children's picture book.
Art style: ${style}. ${styleGuard(style)}
Book title: ${title}.
${sceneHint ? `Story feel: ${sceneHint}` : ''}
${chars.length ? `Feature the main characters: ${chars.map((c: any) => (c.description ? `${c.name} (${c.description})` : c.name)).join('; ')}. Match their labelled reference images exactly.` : ''}
Eye-catching, warm and inviting composition with room for the title.
${titleLine}`;

    const parts: any[] = [{ text: prompt }];
    chars.slice(0, 5).forEach((c: any) => {
      if (c.imageData) parts.push({ text: `Character reference: ${c.name}` }, inline(c.imageData));
    });
    const modelList = MODELS.image[quality] || MODELS.image.standard;
    const imageUrl = await callImage(aiClient, modelList, parts, aspect || '1:1', size || '1K');
    res.json({ imageUrl });
  } catch (error: any) {
    console.error('generate-cover error:', error);
    res.status(500).json({ error: errText(error) });
  }
});

// 8. 그림 말로 수정하기
app.post('/api/edit-image', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { image, instruction, style, aspect, quality, size, textInImage } = req.body;
    const prompt = `Edit the attached children's picture book illustration according to this instruction (Korean): "${instruction}".
Change ONLY what the instruction asks for. Keep everything else exactly the same: composition, characters' faces and outfits, colors and the art style (${style}). ${styleGuard(style)}
${textInImage ? '' : 'Do not add any text or letters.'}`;

    const modelList = MODELS.image[quality] || MODELS.image.standard;
    const imageUrl = await callImage(aiClient, modelList, [{ text: prompt }, inline(image)], aspect || '1:1', size || '1K');
    res.json({ imageUrl });
  } catch (error: any) {
    console.error('edit-image error:', error);
    res.status(500).json({ error: errText(error) });
  }
});

// 8-1. 스타일 샘플 생성 (화풍별 고유 질감/캐릭터 시그니처 시연)
app.post('/api/generate-style-sample', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { style, quality, size } = req.body;
    const def = STYLE_DEFINITIONS[style] || {
      desc: '선택하신 스타일에 맞춘 아름다운 동화 일러스트',
      directive: `Render in authentic "${style}" storybook style with high artistic fidelity.`,
      samplePrompt: `A beautiful signature children's picture book illustration demonstrating the "${style}" artistic look, rich in warmth, character, and texture.`
    };

    const prompt = [
      "Masterpiece children's picture book illustration showcasing the unique art style.",
      `ART STYLE: "${style}".`,
      def.directive,
      `SHOWCASE SUBJECT: ${def.samplePrompt}`,
      'This image is a definitive visual signature of this exact art style. Emphasize the distinct medium textures, stroke techniques, color depth, and character charm of this style. Absolutely NO text, letters, captions, or watermarks.'
    ].join('\n\n');

    const modelList = MODELS.image[quality] || MODELS.image.standard;
    const imageUrl = await callImage(aiClient, modelList, [{ text: prompt }], '1:1', size || '1K');
    res.json({ imageUrl, description: def.desc });
  } catch (error: any) {
    console.error('generate-style-sample error:', error);
    res.status(500).json({ error: errText(error) });
  }
});

// 9. 구연동화 읽어주기 (TTS)
app.post('/api/speak', async (req, res) => {
  try {
    const aiClient = getAI(req);
    const { text, voice } = req.body;
    // 오직 순수한 동화 본문만 낭독하도록 지시문이나 쪽수 접두사를 완전히 제거
    const cleanText = String(text || '')
      .replace(/^\[?\d+쪽\]?\s*/, '')
      .replace(/^(따뜻하고|다정한|동화\s*구연|목소리로|아이들에게|읽어\s*주듯).*?[:\n]+/gi, '')
      .trim();

    if (!cleanText) {
      return res.status(400).json({ error: '읽을 본문이 없습니다.' });
    }

    const result = await tryModels(MODELS.tts, async model => {
      const response = await aiClient.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText,
                speechMetadata: {
                  style: "Warm, gentle, affectionate and crystal-clear children's picture book narration in Standard Korean (표준 한국어). Articulate Korean consonants with high phonetic accuracy: strictly enunciate tense fortis consonants (된소리: ㄲ, ㄸ, ㅃ, ㅆ, ㅉ) with firm tension and zero aspiration. Specifically, pronounce '꼬마' clearly and distinctly as tense [꼬마 / kko-ma], never aspirated as '코마'. Maintain authentic Korean bedtime story diction."
                }
              } as any
            ]
          }
        ],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } } }
        }
      });
      const data = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
      if (!data?.data) throw new Error('목소리를 생성하지 못했습니다.');
      return data.data;
    });
    res.json({ audioData: result });
  } catch (error: any) {
    console.error('speak error:', error);
    res.status(500).json({ error: errText(error) });
  }
});



// API 404 핸들러: API 요청이 Vite의 HTML(<!doctype)로 빠지지 않도록 항상 JSON 반환
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API 요청 경로를 찾을 수 없습니다: ${req.method} ${req.originalUrl}` });
});

// ---------------- VITE / STATIC SERVING ---------------- //
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Tale Maker server listening on port ${PORT}`);
});
