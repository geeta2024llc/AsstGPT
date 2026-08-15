
import KnowledgeBaseManager from '@/components/knowledge-base-manager';
import { BookOpen } from 'lucide-react';

export default function KnowledgeBasePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-headline text-3xl font-bold flex items-center gap-2.5">
          <BookOpen className="h-7 w-7 text-primary" /> AI Memory
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Feed verified business facts, store hours, pricing FAQs, and documents to your AI agents. 
          The AI uses Retrieval-Augmented Generation (RAG) to accurately answer customer questions 24/7.
        </p>
      </div>
      <KnowledgeBaseManager />
    </div>
  );
}
