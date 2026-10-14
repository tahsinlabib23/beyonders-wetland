"""Bounded retries for transient remote access; never retry authentication failures."""
import logging
import time


def remote_call(operation, attempts=3, sleep=time.sleep):
    if not 1 <= attempts <= 3:
        raise ValueError("Remote attempts must be between one and three.")
    for attempt in range(attempts):
        try:
            return operation()
        except Exception as error:
            response = getattr(error, "response", None)
            status = getattr(response, "status_code", None)
            transient = status in (408, 429, 500, 502, 503, 504) or isinstance(error, (TimeoutError, ConnectionError))
            # Requests/httpx connection and timeout errors may not inherit builtins.
            transient |= type(error).__name__ in {"Timeout", "ConnectTimeout", "ReadTimeout", "ConnectionError", "ConnectError", "ReadError"}
            if status in (401, 403) or not transient or attempt + 1 == attempts:
                raise
            logging.warning("Transient remote access failure; retry %d/%d", attempt + 2, attempts)
            sleep(2 ** attempt)
