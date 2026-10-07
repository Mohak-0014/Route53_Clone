import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";

/** Empty / no-match state used inside Cloudscape tables. */
export function TableEmptyState({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
      <SpaceBetween size="m">
        <div>
          <b>{title}</b>
          <Box variant="p" color="inherit">
            {subtitle}
          </Box>
        </div>
        {action}
      </SpaceBetween>
    </Box>
  );
}
