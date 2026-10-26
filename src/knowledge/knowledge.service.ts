import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CATEGORY_LABEL } from '../service-desk/labels'

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Central de ajuda. Busca por palavras-chave com pontuação simples (título e tags pesam mais). */
@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, limit = 3) {
    const terms = normalize(query)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
    if (terms.length === 0) return []

    const articles = await this.prisma.article.findMany()
    return articles
      .map((article) => {
        const title = normalize(article.title)
        const content = normalize(article.content)
        const tags = article.tags.map(normalize)
        const score = terms.reduce(
          (sum, term) =>
            sum +
            (title.includes(term) ? 3 : 0) +
            (tags.some((tag) => tag.includes(term)) ? 3 : 0) +
            (content.includes(term) ? 1 : 0),
          0,
        )
        return { article, score }
      })
      .filter((r) => r.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ article, score }) => ({
        slug: article.slug,
        title: article.title,
        content: article.content,
        category: article.category ? CATEGORY_LABEL[article.category] : null,
        relevance: score,
      }))
  }
}
