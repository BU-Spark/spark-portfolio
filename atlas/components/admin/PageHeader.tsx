// Sticky canvas top bar for redesigned admin pages (Spark Control). Mono eyebrow
// + display H1 on the left; an optional right slot for search / page actions.
// Pairs with the `.content` wrapper for the page body.
export default function PageHeader({
  eyebrow, title, children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sc-topbar">
      <div>
        <div className="ey">{eyebrow}</div>
        <h1>{title}</h1>
      </div>
      <div className="grow" />
      {children}
    </div>
  );
}
