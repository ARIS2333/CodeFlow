"""Create the study tables before the web server starts."""

from dotenv import load_dotenv

from database import initialize_database


if __name__ == "__main__":
    load_dotenv()
    initialize_database()
    print("Study database is ready.")
