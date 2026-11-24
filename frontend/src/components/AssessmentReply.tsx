import { CircleHelp, Database } from "lucide-react";
import type { QueryResponse } from "../types/agent";

export function AssessmentReply({ response }: { response: QueryResponse }) {
  const clarifying = response.status === "clarify";
  const Icon = clarifying ? CircleHelp : Database;
  return (
    <section role="status" className={`mt-3 rounded-lg border p-4 text-sm leading-relaxed ${clarifying ? "border-amber-200 bg-amber-50/60 text-slate-800" : "border-slate-200 bg-slate-50 text-slate-800"}`}>
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {clarifying ? "需要补充信息" : "当前数据不足"}
      </h3>
      <p className="whitespace-pre-wrap break-words">{response.message}</p>
      {response.missing_information.length > 0 && (
        <div className="mt-3">
          <p className="font-semibold">{clarifying ? "需要确认的内容" : "缺少的信息"}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {response.missing_information.map((item, index) => <li key={`${index}-${item}`} className="break-words">{item}</li>)}
          </ul>
        </div>
      )}
      {response.questions.length > 0 && (
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          {response.questions.map((question, index) => <li key={`${index}-${question}`} className="break-words">{question}</li>)}
        </ol>
      )}
    </section>
  );
}
