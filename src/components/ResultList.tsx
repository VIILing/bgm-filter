import { SubjectCard } from "~/components/SubjectCard";
import type { CoverUrls, SubjectCardDto } from "~/shared/subject-contract";

export interface ResultListProps {
  items: SubjectCardDto[];
  /** 以字符串 id 为键的封面 URL；缺失 / null 时卡片显示占位块。 */
  covers: Record<string, CoverUrls | null>;
  onTagClick: (tag: string) => void;
}

export function ResultList({ items, covers, onTagClick }: ResultListProps) {
  return (
    <ul className="divide-y divide-slate-100" aria-label="条目结果">
      {items.map((subject) => (
        <SubjectCard
          key={subject.id}
          subject={subject}
          cover={covers[String(subject.id)] ?? null}
          onTagClick={onTagClick}
        />
      ))}
    </ul>
  );
}
