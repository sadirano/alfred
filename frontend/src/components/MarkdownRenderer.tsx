import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";

/**
 * Custom component overrides for react-markdown.
 *
 * – Links open in a new tab.
 * – Checkboxes in task lists are rendered as styled, non-interactive checkboxes.
 * – Code blocks get a copy button and language badge.
 * – Images are capped to fit the container.
 */
const components: Components = {
  a({ href, children, ...rest }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
        {...rest}
      >
        {children}
      </a>
    );
  },

  input({ checked, ...rest }) {
    return (
      <input
        type="checkbox"
        checked={checked}
        disabled
        className="mr-1.5 accent-blue-500 pointer-events-none"
        {...rest}
      />
    );
  },

  pre({ children, ...rest }) {
    return (
      <pre
        className="relative group/code overflow-x-auto rounded-lg bg-zinc-950 border border-zinc-800 p-4 text-sm leading-relaxed"
        {...rest}
      >
        <button
          type="button"
          className="absolute top-2 right-2 px-2 py-1 text-[10px] font-medium rounded bg-zinc-800 text-zinc-400 opacity-0 group-hover/code:opacity-100 hover:bg-zinc-700 hover:text-zinc-200 transition-all"
          onClick={(e) => {
            const code = (e.currentTarget.parentElement as HTMLPreElement)
              ?.querySelector("code")
              ?.textContent;
            if (code) {
              navigator.clipboard.writeText(code);
              const btn = e.currentTarget;
              btn.textContent = "Copied!";
              setTimeout(() => {
                btn.textContent = "Copy";
              }, 1500);
            }
          }}
        >
          Copy
        </button>
        {children}
      </pre>
    );
  },

  code({ className, children, ...rest }) {
    // Inline code (no className from highlight)
    const isBlock = className?.startsWith("hljs") || className?.startsWith("language-");
    if (!isBlock) {
      return (
        <code
          className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[0.85em] font-mono"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },

  img({ src, alt, ...rest }) {
    return (
      <img
        src={src}
        alt={alt || ""}
        className="max-w-full rounded-lg border border-zinc-800"
        loading="lazy"
        {...rest}
      />
    );
  },

  table({ children, ...rest }) {
    return (
      <div className="overflow-x-auto my-4 rounded-lg border border-zinc-800">
        <table className="w-full text-sm" {...rest}>
          {children}
        </table>
      </div>
    );
  },

  th({ children, ...rest }) {
    return (
      <th
        className="px-3 py-2 text-left text-xs font-semibold text-zinc-300 bg-zinc-900 border-b border-zinc-800"
        {...rest}
      >
        {children}
      </th>
    );
  },

  td({ children, ...rest }) {
    return (
      <td
        className="px-3 py-2 border-b border-zinc-800/50 text-zinc-300"
        {...rest}
      >
        {children}
      </td>
    );
  },

  blockquote({ children, ...rest }) {
    return (
      <blockquote
        className="border-l-[3px] border-blue-500/60 pl-4 my-3 text-zinc-400 italic"
        {...rest}
      >
        {children}
      </blockquote>
    );
  },

  hr() {
    return <hr className="my-6 border-zinc-800" />;
  },
};

interface MarkdownRendererProps {
  children: string;
  className?: string;
}

export default function MarkdownRenderer({
  children,
  className = "",
}: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
