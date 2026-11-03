import { SubjectCard } from "~/components/SubjectCard";
import type { SubjectCardDto } from "~/shared/subject-contract";

export interface ResultListProps {
  items: SubjectCardDto[];
  onTagClick: (tag: string) => void;
}

export function ResultList({ items, onTagClick }: ResultListProps) {
  return (
    <ul className="divide-y divide-slate-100" aria-label="条目结果">
      {items.map((subject) => (
        <SubjectCard key={subject.id} subject={subject} onTagClick={onTagClick} />
      ))}
    </ul>
  );
}
