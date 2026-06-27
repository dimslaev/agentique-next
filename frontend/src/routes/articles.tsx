import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArticlesService, type ArticlePublic } from "@/client";

export const Route = createFileRoute("/articles")({
  component: ArticlesPage,
  head: () => ({
    meta: [{ title: "Articles - Agentique" }],
  }),
});

function ArticlesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["articles"],
    queryFn: () => ArticlesService.readArticles({ limit: 20 }),
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4 text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4 text-destructive">
        Failed to load articles.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-12 px-4">
      <h1 className="text-2xl font-semibold mb-8">Latest articles</h1>
      <ul className="space-y-6">
        {data.data.map((article: ArticlePublic) => (
          <li key={article.id} className="border-b pb-6">
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
                    {new Date(article.published_at).toLocaleDateString()}
                  </span>
                </>
              )}
            </div>
            <a
              href={article.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="text-base font-medium hover:underline"
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
    </div>
  );
}
