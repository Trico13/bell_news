// scripts/fetch-news.mjs
// Coleta notícias das fontes (RSS), usa a API da Claude para SELECIONAR as
// mais relevantes, classificá-las por tema, aplicar as exclusões e gerar um
// RESUMO curto e neutro de cada uma — sempre com o link pro original.
// Se a IA falhar ou não houver chave configurada, cai automaticamente num
// filtro por palavras-chave (sem custo), pra o feed nunca quebrar.

import Parser from "rss-parser";
import { writeFile, mkdir } from "fs/promises";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; PanoramaFeed/1.0)" },
});

// ---------------------------------------------------------------------------
// 1) FONTES  (nome + url do RSS)
// O script avisa no log quais responderam e quais falharam, sem derrubar
// as demais. Se uma fonte falhar sempre, comente ou remova a linha dela.
// ---------------------------------------------------------------------------
const FONTES = [
  { nome: "G1", url: "https://g1.globo.com/rss/g1/" },
  { nome: "G1 São Paulo", url: "https://g1.globo.com/dynamo/sao-paulo/rss2.xml" },
  { nome: "BBC Brasil", url: "https://feeds.bbci.co.uk/portuguese/rss.xml" },
];

// ---------------------------------------------------------------------------
// 2) TEMAS E EXCLUSÕES
// ---------------------------------------------------------------------------
const TEMAS = {
  brasil: "Brasil",
  sp: "São Paulo",
  mundo: "Mundo",
  cultura: "Cultura",
  entretenimento: "Entretenimento",
  checagem: "Checagem de fatos",
};

const EXCLUSOES_TEXTO = [
  "crimes hediondos, violência explícita, crueldade",
  "crimes contra crianças",
  "conteúdo sexual ou pornográfico",
  "sensacionalismo / clickbait sem substância",
];

// usado só no modo sem-IA (fallback)
const PALAVRAS_EXCLUSAO = [
  "estupro", "abuso sexual", "pedofilia", "pornografia", "conteudo adulto",
  "chacina", "linchamento", "tortura", "mutilacao", "decapita",
  "assassinato brutal", "crime hediondo", "feminicidio", "violencia sexual",
  "abuso infantil", "exploracao infantil", "crianca morta", "crianca assassinada",
];
const PALAVRAS_TEMA = {
  entretenimento: ["familia real", "realeza", "rei charles", "rainha", "kate middleton",
    "principe william", "principe harry", "sandy", "xororo", "wanessa camargo",
    "zeze di camargo", "celebridade", "novela", "gshow"],
  cultura: ["cinema", "filme", "musica", "show", "exposicao", "livro", "teatro", "arte"],
  sp: ["sao paulo", "capital paulista", "prefeitura de sp"],
  checagem: ["checagem", "fact-check", "verificamos", "e falso", "e enganoso"],
  brasil: ["brasil", "brasilia", "governo federal", "congresso", "stf", "lula", "ministro"],
};

function semAcento(txt) {
  return (txt || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// 3) SELEÇÃO + RESUMO COM IA (Claude)
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `Você é o curador de um feed de notícias pessoal, calmo e confiável, para uma leitora que saiu das redes sociais e quer se informar sem sensacionalismo.

Você recebe uma lista de notícias (id, título, trecho, fonte). Para cada uma, decida se entra no feed e, se entrar, classifique e resuma.

TEMAS válidos: ${Object.keys(TEMAS).join(", ")}.

EXCLUA (incluir=false) qualquer notícia que envolva:
${EXCLUSOES_TEXTO.map((e) => "- " + e).join("\n")}

Para as incluídas, escreva um "resumo" de 1 a 2 frases, em português, tom neutro e informativo (sem alarmismo, sem opinião, sem ponto de exclamação). O resumo deve dar o essencial para quem talvez não clique — mas nunca copie o texto original: escreva com suas próprias palavras.

Priorize notícias de real interesse e impacto; descarte conteúdo repetido, promocional ou fútil. É melhor um feed enxuto e bom do que longo.

Responda APENAS com um array JSON válido, sem markdown, cada item assim:
{"id": "...", "incluir": true/false, "tema": "um dos temas", "resumo": "..."}`;

async function classificarComIA(itens) {
  const payload = itens.map((it) => ({
    id: it.id,
    titulo: it.title,
    trecho: (it.contentSnippet || "").slice(0, 300),
    fonte: it.fonte,
  }));

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`API ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const texto = data.content.map((b) => b.text || "").join("");
  const limpo = texto.replace(/```json|```/g, "").trim();
  return JSON.parse(limpo);
}

// ---------------------------------------------------------------------------
// 3b) FALLBACK sem IA (palavras-chave) — usado se a API falhar
// ---------------------------------------------------------------------------
function classificarPorPalavra(item) {
  const texto = semAcento(`${item.title} ${item.contentSnippet || ""}`);
  if (PALAVRAS_EXCLUSAO.find((p) => texto.includes(p))) {
    return { incluir: false };
  }
  for (const tema of Object.keys(PALAVRAS_TEMA)) {
    if (PALAVRAS_TEMA[tema].find((p) => texto.includes(p))) {
      return { incluir: true, tema, resumo: null };
    }
  }
  return { incluir: true, tema: "mundo", resumo: null };
}

// ---------------------------------------------------------------------------
// 4) CLIMA (Open-Meteo, gratuito, sem chave) — São Paulo
// ---------------------------------------------------------------------------
async function buscarClima() {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=-23.55&longitude=-46.63&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FSao_Paulo";
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      max: data.daily.temperature_2m_max[0],
      min: data.daily.temperature_2m_min[0],
      chuva: data.daily.precipitation_probability_max[0],
    };
  } catch (err) {
    console.error("Clima falhou (seguindo sem):", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 5) COLETA DOS RSS
// ---------------------------------------------------------------------------
async function coletar() {
  let contador = 0;
  const brutos = [];
  for (const fonte of FONTES) {
    try {
      const feed = await parser.parseURL(fonte.url);
      const n = feed.items.length;
      for (const item of feed.items.slice(0, 12)) {
        brutos.push({
          id: `n${contador++}`,
          title: item.title,
          link: item.link,
          contentSnippet: item.contentSnippet || item.content || "",
          pubDate: item.pubDate || item.isoDate,
          fonte: fonte.nome,
        });
      }
      console.log(`OK  ${fonte.nome}: ${n} itens`);
    } catch (err) {
      console.error(`FALHOU  ${fonte.nome} (${fonte.url}): ${err.message}`);
    }
  }
  return brutos;
}

// ---------------------------------------------------------------------------
// 6) MAIN
// ---------------------------------------------------------------------------
async function main() {
  const brutos = await coletar();
  const clima = await buscarClima();

  if (brutos.length === 0) {
    console.warn("Nenhuma notícia coletada — confira as URLs em FONTES.");
    await salvar([], clima, "nenhuma fonte respondeu");
    return;
  }

  let selecao = null;
  let modo = "ia";

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const resultado = [];
      for (let i = 0; i < brutos.length; i += 25) {
        const lote = brutos.slice(i, i + 25);
        resultado.push(...(await classificarComIA(lote)));
      }
      selecao = Object.fromEntries(resultado.map((r) => [r.id, r]));
      console.log(`IA classificou ${resultado.length} itens`);
    } catch (err) {
      console.error("IA falhou, usando fallback por palavra-chave:", err.message);
      selecao = null;
    }
  } else {
    console.log("Sem ANTHROPIC_API_KEY — usando fallback por palavra-chave.");
  }

  let noticias;
  if (selecao) {
    noticias = brutos
      .filter((b) => selecao[b.id]?.incluir)
      .map((b) => ({
        titulo: b.title,
        fonte: b.fonte,
        link: b.link,
        hora: b.pubDate,
        tema: selecao[b.id].tema,
        resumo: selecao[b.id].resumo || null,
      }));
  } else {
    modo = "palavras-chave";
    noticias = brutos
      .map((b) => ({ ...b, c: classificarPorPalavra(b) }))
      .filter((b) => b.c.incluir)
      .map((b) => ({
        titulo: b.title,
        fonte: b.fonte,
        link: b.link,
        hora: b.pubDate,
        tema: b.c.tema,
        resumo: null,
      }));
  }

  await salvar(noticias, clima, modo);
}

async function salvar(noticias, clima, modo) {
  const saida = {
    gerado_em: new Date().toISOString(),
    modo,
    clima,
    noticias,
  };
  await mkdir("docs/data", { recursive: true });
  await writeFile("docs/data/feed.json", JSON.stringify(saida, null, 2));
  console.log(`OK: ${noticias.length} notícias salvas (modo: ${modo})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
