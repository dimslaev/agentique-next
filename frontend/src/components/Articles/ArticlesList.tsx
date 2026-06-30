import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { type ArticlePublic, ArticlesService } from "@/client"
import { useFilters } from "@/context/filters"
import { cn } from "@/lib/utils"

const PUBLISHED_DAYS: Record<string, number> = { "3d": 3, "1w": 7, "1m": 30 }

function cutoffIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function ArticleSkeleton() {
  return (
    <li className="py-5 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="h-3 w-8 rounded bg-muted" />
        <div className="h-3 w-10 rounded bg-muted" />
      </div>
      <div className="h-4 w-3/4 rounded bg-muted mb-2" />
      <div className="h-3 w-full rounded bg-muted mb-1" />
      <div className="h-3 w-5/6 rounded bg-muted" />
    </li>
  )
}

export function ArticlesList() {
  const { filters } = useFilters()
  const { search, dateRange, sort, category, kind } = filters

  const since = cutoffIso(PUBLISHED_DAYS[dateRange] ?? 7)

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ["articles", search, dateRange, sort, category, kind],
    queryFn: () => {
      if (search) {
        return ArticlesService.searchArticles({ q: search, limit: 50 })
      }
      return ArticlesService.readArticles({
        limit: 50,
        since,
        sort,
        category: category || undefined,
        kind: kind || undefined,
      })
    },
    placeholderData: keepPreviousData,
  })

  if (isLoading) {
    return (
      <ul className="divide-y divide-border/40">
        {Array.from({ length: 8 }).map((_, i) => (
          <ArticleSkeleton key={i} />
        ))}
      </ul>
    )
  }

  if (isError || !data) {
    return (
      <div className="py-12 text-sm text-destructive">
        Failed to load articles.
      </div>
    )
  }

  const articles = data.data

  return (
    <div className="relative">
      {articles.length === 0 ? (
        <div className="py-12 text-sm text-muted-foreground">
          No articles found.
        </div>
      ) : (
        <ul
          className={cn(
            "divide-y divide-border/40 transition-opacity duration-200",
            isFetching && "opacity-50",
          )}
        >
          {articles.map((article: ArticlePublic) => (
            <li key={article.id} className="py-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <span>{article.source}</span>
                {article.score != null && (
                  <>
                    <span>·</span>
                    <span>score {article.score}</span>
                  </>
                )}
                {article.published_at && (
                  <>
                    <span>·</span>
                    <span>
                      {new Date(article.published_at).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                        },
                      )}
                    </span>
                  </>
                )}
                {article.kind && (
                  <>
                    <span>·</span>
                    <span>{article.kind}</span>
                  </>
                )}
              </div>
              <a
                href={article.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium hover:underline"
              >
                {article.title}
              </a>
              {article.summary && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
                  {article.summary}
                </p>
              )}
              {article.categories && article.categories.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {article.categories.map((cat: string) => (
                    <span
                      key={cat}
                      className="text-xs px-2 py-0.5 rounded-full bg-muted"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isFetching && articles.length > 0 && (
        <p className="pt-4 text-xs text-muted-foreground">
          {articles.length} article{articles.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  )
}
