// scripts/fetch-news.mjs
// Coleta notícias das fontes definidas, classifica por tema e aplica os
// filtros de exclusão usando palavras-chave (sem IA, sem custo), e salva
// o resultado em docs/data/feed.json — que é o arquivo que o site
// (docs/index.html) lê.

import Parser from "rss-parser";
import { writeFile, mkdir } from "fs/promises";

const parser = new Parser({
  headers: { "User-Agent": "Mozilla/5.0 (compatible; PanoramaFeed/1.0)" },
});

// ---------------------------------------------------------------------------
// 1) FONTES
// Ajuste/adicione URLs de RSS aqui. Se uma fonte não tiver RSS confiável,
// dá pra trocar por outra do mesmo veículo ou remover a linha.
// ---------------------------------------------------------------------------
const FONTES = [
  { nome: "BBC Brasil", url: "https://feeds.bbci.co.uk/portuguese/rss.xml" },
  { nome: "G1", url: "https://g1.globo.com/rss/g1/" },
  // { nome: "DW Brasil", url: "" },              // TODO: confirmar feed
  // { nome: "O Estado de S. Paulo", url: "" },   // TODO: confirmar feed
  // { nome: "CNN Brasil", url: "" },              // TODO: confirmar feed
];

// ---------------------------------------------------------------------------
// 2) TEMAS E EXCLUSÕES (espelha o que foi definido na conversa)
// ---------------------------------------------------------------------------
const TEMAS_PRINCIPAIS = [
  "mundo",       // grande impacto - Mundo
  "brasil",      // grande impacto - Brasil
  "sp",          // grande impacto - São Paulo
  "realeza",     // realeza britânica
];
const TEMAS_PRINCIPAIS = [
  "mundo",         // grande impacto - Mundo
  "brasil",        // grande impacto - Brasil
  "sp",            // grande impacto - São Paulo
  "entretenimento", // notícias leves / fofocas do bem
];
const TEMAS_VALIDOS = [...TEMAS_PRINCIPAIS];

// Palavras que, se aparecerem no título ou no trecho, descartam a notícia
// na hora — sem exceção. Tudo em minúsculas, sem acento (a checagem remove
// acentos antes de comparar).
const PALAVRAS_EXCLUSAO = [
  "estupro", "abuso sexual", "pedofilia", "pornografia", "conteudo adulto",
  "chacina", "linchamento", "tortura", "mutilacao", "decapita",
  "assassinato brutal", "crime hediondo", "feminicidio", "violencia sexual",
  "abuso infantil", "exploracao infantil", "crianca morta", "crianca assassinada",
];

// Palavras-chave por tema, checadas nessa ordem (a primeira que bater define
// o tema da notícia). Ajuste livremente conforme o feed for rodando.
const PALAVRAS_TEMA = {
  entretenimento: ["familia real", "realeza", "rei charles", "rainha", "princesa kate",
    "kate middleton", "principe william", "principe harry", "buckingham",
    "monarquia britanica", "windsor", "sandy", "xororo", "wanessa camargo",
    "zeze di camargo", "zeze camargo"],
  sp: ["sao paulo", "prefeitura de sp", "capital paulista", "sp e regiao"],
  brasil: ["brasil", "brasilia", "governo brasileiro", "governo federal",
    "congresso nacional", "camara dos deputados", "senado federal", "stf",
    "eleicao", "eleicoes", "presidente lula", "ministro"],
};

function semAcento(txt) {
  return (txt || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function classificarItem(item) {
  const texto = semAcento(`${item.title} ${item.contentSnippet || ""}`);

  const excluida = PALAVRAS_EXCLUSAO.find((p) => texto.includes(p));
  if (excluida) {
    return { incluir: false, tema: null, motivo: `Excluída por conteúdo sensível` };
  }

  for (const tema of Object.keys(PALAVRAS_TEMA)) {
    const achou = PALAVRAS_TEMA[tema].find((p) => texto.includes(p));
    if (achou) {
      return { incluir: true, tema, motivo: `Palavra-chave: "${achou.trim()}"` };
    }
  }

  // fallback: nada específico bateu — assume tema "mundo" (a maioria das
  // fontes internacionais cai aqui) e deixa passar.
  return { incluir: true, tema: "mundo", motivo: "Sem palavra-chave específica — tema geral" };
}

// ---------------------------------------------------------------------------
// 3) CLIMA (Open-Meteo, gratuito, sem chave) — São Paulo por padrão
// ---------------------------------------------------------------------------
async function buscarClima() {
  const lat = -23.55, lon = -46.63; // São Paulo
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=America%2FSao_Paulo`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  return {
    max: data.daily.temperature_2m_max[0],
    min: data.daily.temperature_2m_min[0],
    chuva: data.daily.precipitation_probability_max[0],
  };
}

// ---------------------------------------------------------------------------
// 4) COLETA
// ---------------------------------------------------------------------------
async function coletar() {
  let contador = 0;
  const brutos = [];

  for (const fonte of FONTES) {
    try {
      const feed = await parser.parseURL(fonte.url);
      for (const item of feed.items.slice(0, 15)) {
        brutos.push({
          id: `n${contador++}`,
          title: item.title,
          link: item.link,
          contentSnippet: item.contentSnippet,
          pubDate: item.pubDate,
          fonte: fonte.nome,
        });
      }
    } catch (err) {
      console.error(`Falha ao ler ${fonte.nome} (${fonte.url}):`, err.message);
    }
  }

  if (brutos.length === 0) {
    console.warn("Nenhuma notícia coletada — confira as URLs em FONTES.");
    return [];
  }

  return brutos
    .map((b) => ({ ...b, classificacao: classificarItem(b) }))
    .filter((b) => b.classificacao.incluir)
    .map((b) => ({
      titulo: b.title,
      fonte: b.fonte,
      link: b.link,
      hora: b.pubDate,
      tema: b.classificacao.tema,
      motivo: b.classificacao.motivo,
    }));
}

// ---------------------------------------------------------------------------
// 5) MAIN
// ---------------------------------------------------------------------------
async function main() {
  const [noticias, clima] = await Promise.all([coletar(), buscarClima()]);

  const saida = {
    gerado_em: new Date().toISOString(),
    clima,
    noticias,
  };

  await mkdir("docs/data", { recursive: true });
  await writeFile("docs/data/feed.json", JSON.stringify(saida, null, 2));
  console.log(`OK: ${noticias.length} notícias salvas em docs/data/feed.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
