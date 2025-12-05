import { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button } from '@mui/material';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    public render() {
        if (this.state.hasError) {
            return (
                <Box sx={{ p: 2, color: 'error.main', bgcolor: '#fff0f0', border: '1px solid red', borderRadius: 1 }}>
                    <Typography variant="h6">Something went wrong.</Typography>
                    <Typography variant="body2" sx={{ mt: 1, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                        {this.state.error?.toString()}
                    </Typography>
                    <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        sx={{ mt: 2 }}
                        onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                    >
                        Try Again
                    </Button>
                </Box>
            );
        }

        return this.props.children;
    }
}
