class AuthService:
    def login(self, username):
        return self.validate(username)

    def validate(self, username):
        return bool(username)
