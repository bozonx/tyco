"""Enumerate live AT-SPI applications despite concurrent desktop teardown."""


def application_nodes(desktop):
    for index in range(desktop.get_child_count()):
        try:
            application = desktop.get_child_at_index(index)
            if application is not None:
                yield application, application.get_name() or ""
        except Exception:
            # AT-SPI's child list can retain a defunct remote application. A
            # missing required control still fails the caller's own assertion.
            continue
